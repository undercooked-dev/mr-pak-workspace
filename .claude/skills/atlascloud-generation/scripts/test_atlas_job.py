"""Offline provider-contract tests; no credentials, uploads or paid requests."""
import argparse
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('atlas_job', Path(__file__).with_name('atlas_job.py'))
job = importlib.util.module_from_spec(spec)
spec.loader.exec_module(job)


class JobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='atlas-skill-test-')
        self.base = Path(self.temp.name)
        self.input = self.base / 'input.json'
        self.input.write_text('{"prompt":"a brass robot"}', encoding='utf-8')
        self.args = argparse.Namespace(kind='image', model='example/model', input=str(self.input),
                                       out=str(self.base / 'run'), dry_run=False, env=None)
        self.api = Mock()
        self.api.submit.return_value = {'data': {'id': 'demo', 'status': 'processing'}}

    def tearDown(self):
        self.temp.cleanup()

    def receipt(self):
        path = self.base / 'job.json'
        job.save_json(path, {'provider': 'atlascloud', 'model': 'example/model', 'prediction_id': 'demo'})
        return argparse.Namespace(command='result', job=str(path), env=None, refresh=False)

    def test_dry_run_has_no_client_network_or_receipt(self):
        self.args.dry_run = True
        with patch.object(job, 'client', side_effect=AssertionError('No client')):
            result = job.submit(self.args)
        self.assertTrue(result['dry_run'])
        self.assertFalse(result['live_schema_checked'])
        self.assertFalse((self.base / 'run').exists())

    def test_existing_receipt_blocks_duplicate_submission(self):
        job.submit(self.args, self.api)
        with self.assertRaises(ValueError):
            job.submit(self.args, self.api)
        self.api.submit.assert_called_once_with('image', 'example/model', {'prompt': 'a brass robot'})
        self.assertEqual(job.read_json(self.base / 'run/job.json')['prediction_id'], 'demo')

    def test_uncertain_submission_keeps_guard_without_private_error(self):
        self.api.submit.side_effect = TimeoutError('private provider token')
        with self.assertRaisesRegex(RuntimeError, 'outcome is unknown'):
            job.submit(self.args, self.api)
        saved = job.read_json(self.base / 'run/job.json')
        self.assertEqual(saved['status'], 'submission_unknown')
        self.assertNotIn('private provider token', json.dumps(saved))
        with self.assertRaises(ValueError):
            job.submit(self.args, self.api)
        self.api.submit.assert_called_once()

    def test_missing_id_keeps_submission_guard(self):
        self.api.submit.return_value = {'data': {'status': 'processing'}}
        with self.assertRaisesRegex(RuntimeError, 'outcome is unknown'):
            job.submit(self.args, self.api)
        self.assertEqual(job.read_json(self.base / 'run/job.json')['status'], 'submission_unknown')

    def test_unwrapped_submission_is_supported(self):
        self.api.submit.return_value = {'id': 'demo', 'status': 'completed', 'outputs': []}
        self.assertEqual(job.submit(self.args, self.api)['prediction_id'], 'demo')
        self.assertTrue((self.base / 'run/result.json').is_file())

    def test_processing_never_downloads_or_resubmits(self):
        self.api.status.return_value = {'data': {'id': 'demo', 'status': 'processing'}}
        with patch.object(job, 'download_result') as download:
            self.assertEqual(job.resume(self.receipt(), self.api)['status'], 'processing')
            download.assert_not_called()
        self.api.submit.assert_not_called()
        self.api.status.assert_called_once_with('demo')

    def test_terminal_failure_and_completed_error_are_not_downloaded(self):
        args = self.receipt()
        for status in ('failed', 'canceled', 'cancelled', 'timeout', 'error', 'completed'):
            with self.subTest(status=status):
                self.api.status.return_value = {'data': {'id': 'demo', 'status': status, 'error': 'private error'}}
                args.refresh = True
                with patch.object(job, 'download_result') as download:
                    with self.assertRaisesRegex(RuntimeError, 'Provider returned an error'):
                        job.resume(args, self.api)
                    download.assert_not_called()
                self.assertTrue((self.base / 'result.json').exists())

    def test_saved_success_works_without_provider_history(self):
        args = self.receipt()
        job.save_json(self.base / 'result.json', {'data': {'id': 'demo', 'status': 'completed', 'outputs': ['plain text']}})
        with patch.object(job, 'client', side_effect=AssertionError('No provider request')):
            result = job.resume(args)
        self.assertEqual(result['status'], 'result_saved')
        self.assertEqual(result['review'], 'pending')

    def test_refresh_uses_existing_prediction(self):
        args = self.receipt()
        job.save_json(self.base / 'result.json', {'data': {'id': 'demo', 'status': 'completed', 'outputs': ['old text']}})
        args.refresh = True
        self.api.status.return_value = {'data': {'id': 'demo', 'status': 'succeeded', 'outputs': ['new text']}}
        self.assertEqual(job.resume(args, self.api)['status'], 'result_saved')
        self.api.status.assert_called_once_with('demo')
        self.api.submit.assert_not_called()
        self.assertEqual(job.read_json(self.base / 'result.json')['data']['outputs'], ['new text'])

    def test_download_failure_preserves_result_for_offline_recovery(self):
        args = self.receipt()
        self.api.status.return_value = {'data': {'id': 'demo', 'status': 'completed', 'outputs': ['https://example.invalid/a.png']}}
        with patch.object(job, 'download_result', side_effect=OSError('download interrupted')):
            with self.assertRaises(OSError):
                job.resume(args, self.api)
        with patch.object(job, 'client', side_effect=AssertionError('No provider request')), \
                patch.object(job, 'download_result', return_value=[{'path': 'a.png'}]):
            self.assertEqual(job.resume(args)['status'], 'downloaded')

    def test_download_only_outputs_and_reuse_existing_files(self):
        result = {'data': {'id': 'demo', 'input': {'image': 'https://example.invalid/private.png'},
                           'urls': {'get': 'https://example.invalid/status'},
                           'outputs': ['https://example.invalid/model.glb',
                                       {'maps': {'normal': 'https://example.invalid/normal.png'}},
                                       {'url': 'https://example.invalid/model.glb'}]}}
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.side_effect = [b'mesh', b'', b'normal', b'']
        with patch.object(job, 'urlopen', return_value=response) as opened:
            outputs = job.download_result(result, self.base / 'assets')
            self.assertEqual(len(outputs), 2)
            self.assertEqual(opened.call_count, 2)
            self.assertEqual(Path(outputs[0]['path']).read_bytes(), b'mesh')
            job.download_result(result, self.base / 'assets')
            self.assertEqual(opened.call_count, 2)

    def test_invalid_inputs_never_submit(self):
        for value in ([], {'model': 'other'}, {'images': ['https://example.invalid/a.png']},
                      {'enable_sync_mode': True}, {'enable_base64_output': True}):
            with self.subTest(value=value):
                self.input.write_text(json.dumps(value), encoding='utf-8')
                with self.assertRaises(ValueError):
                    job.submit(self.args, self.api)
        self.api.submit.assert_not_called()

    def test_non_atlas_receipt_is_not_sent_to_atlas(self):
        args = self.receipt()
        job.save_json(args.job, {'provider': 'other', 'prediction_id': 'demo', 'model': 'example'})
        with self.assertRaises(ValueError):
            job.resume(args, self.api)
        self.api.status.assert_not_called()

    def test_wrong_prediction_is_rejected(self):
        self.api.status.return_value = {'data': {'id': 'wrong', 'status': 'completed', 'outputs': []}}
        with self.assertRaisesRegex(ValueError, 'does not match'):
            job.resume(self.receipt(), self.api)

    def test_upload_response_variants_and_receipt_reuse(self):
        source = self.base / 'source.png'
        source.write_bytes(b'example image')
        for i, response in enumerate(({'data': {'download_url': 'https://example.invalid/ref.png'}},
                                      {'url': 'https://example.invalid/ref.png'})):
            args = argparse.Namespace(file=str(source), out=str(self.base / f'upload-{i}.json'), env=None)
            self.api.upload_file.return_value = response
            self.assertTrue(job.upload(args, self.api)['uploaded'])
            self.assertEqual(job.read_json(args.out)['url'], 'https://example.invalid/ref.png')
            self.assertTrue(job.upload(args, self.api)['reused'])
        self.assertEqual(self.api.upload_file.call_count, 2)

    def test_http_contract_for_all_generation_kinds(self):
        transport = Mock()
        transport.request.return_value.status_code = 200
        transport.request.return_value.json.return_value = {'data': {'id': 'demo', 'status': 'processing'}}
        api = job.AtlasClient('fake-test-key', transport)
        for kind, endpoint in job.ENDPOINTS.items():
            api.submit(kind, 'example/model', {'prompt': 'robot'})
            transport.request.assert_called_with('POST', job.BASE_URL + endpoint,
                                                  headers={'Authorization': 'Bearer fake-test-key'}, timeout=60,
                                                  allow_redirects=False,
                                                  json={'model': 'example/model', 'prompt': 'robot'})

    def test_http_500_terminal_task_is_preserved_without_retry(self):
        transport = Mock()
        transport.request.return_value.status_code = 500
        transport.request.return_value.json.return_value = {'code': 500, 'data': {'status': 'failed', 'error': 'bad input'}}
        api = job.AtlasClient('fake-test-key', transport)
        self.assertEqual(api.status('demo')['data']['status'], 'failed')
        transport.request.assert_called_once()

    def test_post_http_failure_is_not_retried_or_disclosed(self):
        transport = Mock()
        transport.request.return_value.status_code = 500
        transport.request.return_value.json.return_value = {'message': 'secret provider detail'}
        with self.assertRaisesRegex(RuntimeError, 'HTTP 500') as error:
            job.AtlasClient('fake-test-key', transport).submit('video', 'example/model', {})
        transport.request.assert_called_once()
        self.assertNotIn('secret provider detail', str(error.exception))

    def test_env_key_takes_precedence_without_reading_file(self):
        with patch.dict(job.os.environ, {'ATLASCLOUD_API_KEY': 'fake-environment-key'}), \
                patch.object(job, 'AtlasClient') as client:
            job.client(self.base / 'missing.env')
            client.assert_called_once_with('fake-environment-key')

    def test_cli_upload_does_not_print_private_url(self):
        source = self.base / 'source.png'
        source.write_bytes(b'example')
        self.api.upload_file.return_value = {'data': {'download_url': 'https://example.invalid/private?token=secret'}}
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(job, 'client', return_value=self.api), redirect_stdout(output), redirect_stderr(errors):
            code = job.main(['upload', '--file', str(source), '--out', str(self.base / 'upload.json')])
        self.assertEqual(code, 0)
        self.assertNotIn('secret', output.getvalue() + errors.getvalue())


if __name__ == '__main__':
    unittest.main()
