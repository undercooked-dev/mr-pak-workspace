"""Offline checks for tripo_job.py. A fake API stands in for Tripo: no key, network or credits.

Run: python -m unittest discover -s .agents/skills/tripo-handoff/scripts -p test_tripo_job.py
"""
import contextlib
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import tripo_job  # noqa: E402


class FakeApi:
    """Mimics the calls tripo_job makes, and counts paid submissions."""

    def __init__(self, job, balance=500, model=b'glTF-binary-model'):
        self.job, self.balance, self.model, self.submissions = job, balance, model, 0
        self.requests = types.SimpleNamespace(get=lambda url, timeout: types.SimpleNamespace(status_code=200, content=self.model))

    def call(self, method, endpoint, receipt, **kwargs):
        if endpoint == '/files':
            return {'file_token': 'token-' + kwargs['files']['file'][0]}
        if endpoint == '/account/balance':
            return {'balance': self.balance, 'frozen': 0}
        if endpoint == '/generation/multiview-to-model':
            self.submissions += 1
            self.request = kwargs['json']
            return {'task_id': 'task-1'}
        return {'status': 'success', 'progress': 100, 'credits_consumed': 110, 'output': {'model_url': 'https://assets.example/model'}}


def run(argv, api=None):
    job = tripo_job.Job(argv[argv.index('--job') + 1])
    args = argv
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        if api is None:
            tripo_job.main(args)
        else:
            parsed = types.SimpleNamespace(**{view: None for view in tripo_job.VIEWS}, model=tripo_job.RECIPE['model'], faces=None,
                                           quad=True, texture=True, option=None, expected_credits=None, out=None, name=None, dry_run=False)
            for flag, value in zip(args[1::2], args[2::2]):
                key = flag.lstrip('-').replace('-', '_')
                setattr(parsed, key, int(value) if key in ('faces', 'expected_credits') else value)
            getattr(tripo_job, args[0])(job, parsed, api) if args[0] == 'prepare' else getattr(tripo_job, args[0])(job, api)
    return [json.loads(line) for line in output.getvalue().splitlines()]


class TripoJob(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.views = {}
        for view in ('front', 'left', 'back'):
            self.views[view] = self.temp / f'{view}.png'
            self.views[view].write_bytes(b'png-' + view.encode())
        self.job = str(self.temp / 'job')
        self.prepare = ['prepare', '--job', self.job, '--front', str(self.views['front']), '--left', str(self.views['left']),
                        '--back', str(self.views['back']), '--faces', '12000', '--expected-credits', '110',
                        '--out', str(self.temp / 'out'), '--name', 'creature']

    def test_dry_run_shows_the_proven_recipe_without_key_or_network(self):
        [plan] = run(self.prepare + ['--dry-run'])
        self.assertEqual(plan['request']['model'], 'P2-20260801')
        self.assertTrue(plan['request']['quad'] and plan['request']['pbr'])
        self.assertEqual(plan['request']['face_limit'], 12000)
        self.assertEqual(plan['request']['inputs'], [{'front': 'front.png'}, {'left': 'left.png'}, {'back': 'back.png'}])
        self.assertFalse(Path(self.job).exists(), 'a dry run writes nothing')

    def test_one_job_is_one_submission_and_downloads_never_overwrite(self):
        api = FakeApi(tripo_job.Job(self.job))
        run(self.prepare, api)
        run(['submit', '--job', self.job], api)
        self.assertEqual(api.request['inputs'][1], {'left': 'token-left.png'})
        with self.assertRaisesRegex(RuntimeError, 'already submitted'):
            run(['submit', '--job', self.job], api)
        self.assertEqual(api.submissions, 1)

        events = run(['download', '--job', self.job], api)
        model = Path(events[-1]['downloaded'][0]['file'])
        self.assertEqual(model.name, 'creature.glb')
        run(['download', '--job', self.job], api)  # Recovering the same result is harmless.
        api.model = b'glTF-different-model'
        with self.assertRaisesRegex(RuntimeError, 'nothing was overwritten'):
            run(['download', '--job', self.job], api)

    def test_refuses_when_credits_are_short_or_a_reference_changed(self):
        poor = FakeApi(tripo_job.Job(self.job), balance=20)
        run(self.prepare, poor)
        with self.assertRaisesRegex(RuntimeError, 'Nothing was submitted'):
            run(['submit', '--job', self.job], poor)
        self.assertEqual(poor.submissions, 0)
        self.views['back'].write_bytes(b'edited')
        with self.assertRaisesRegex(RuntimeError, 'reference changed'):
            run(['submit', '--job', self.job], FakeApi(tripo_job.Job(self.job)))

    def test_missing_key_stops_before_any_call(self):
        import os
        saved = os.environ.pop('TRIPO_API_KEY', None)
        cwd = os.getcwd()
        os.chdir(self.temp)
        try:
            with self.assertRaises(SystemExit) as stop:
                tripo_job.main(['status', '--job', self.job, '--env', str(self.temp / 'none.env')])
            if not (Path.home() / '.config/mr-pak/tripo.env').is_file():
                self.assertIn('TRIPO_API_KEY not found', str(stop.exception))
        finally:
            os.chdir(cwd)
            if saved is not None:
                os.environ['TRIPO_API_KEY'] = saved


if __name__ == '__main__':
    unittest.main()
