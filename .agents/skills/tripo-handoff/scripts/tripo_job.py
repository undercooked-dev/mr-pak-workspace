"""Run one Tripo multiview-to-model job through the API, with receipts that make it recoverable.

  python tripo_job.py prepare  --job DIR --front F --left F --back F --faces 12000 --out DIR --name NAME --expected-credits N
  python tripo_job.py submit   --job DIR      # checks the balance, submits once, never retries
  python tripo_job.py poll     --job DIR      # waits, then downloads when the task succeeds
  python tripo_job.py status | download --job DIR

`prepare --dry-run` prints the request without a key, a network call or the requests package.
One job directory is one paid submission. Keep it in an ignored folder: it holds API receipts.
Official contract: https://developers.tripo3d.ai/en/docs/generation-multiview-to-model/p
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from datetime import datetime, timezone

BASE = 'https://openapi.tripo3d.ai/v3'
VIEWS = ['front', 'left', 'back', 'right']
# The settings of the run this workflow was proven on. Confirm the model ID against the live
# documentation before a submission: versions are dated and get replaced.
RECIPE = dict(model='P2-20260801', texture=True, pbr=True, texture_quality='standard',
              texture_alignment='original_image', auto_size=False, quad=True, export_uv=True)
MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'}
SIGNATURES = [(b'glTF', '.glb'), (b'Kaydara FBX Binary', '.fbx'), (b'PK\x03\x04', '.zip')]


class Job:
    def __init__(self, directory):
        self.dir = Path(directory)

    def path(self, name):
        return self.dir / name

    def read(self, name):
        return json.loads(self.path(name).read_text())

    def save(self, name, data):
        self.dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        temp = self.path(name + '.tmp')
        with open(temp, 'w') as file:
            os.chmod(temp, 0o600)
            json.dump(data, file, indent=2)
            file.write('\n')
        temp.replace(self.path(name))


def emit(**fields):
    print(json.dumps(fields), flush=True)


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def find_key(explicit=None):
    if os.environ.get('TRIPO_API_KEY'):
        return os.environ['TRIPO_API_KEY'].strip()
    for candidate in [explicit, '.env.tripo', Path.home() / '.config/mr-pak/tripo.env']:
        if candidate and Path(candidate).is_file():
            for line in Path(candidate).read_text().splitlines():
                key, _, value = line.partition('=')
                if key.strip() == 'TRIPO_API_KEY' and value.strip():
                    return value.strip().strip('"').strip("'")
    return ''


def build_options(args):
    options = dict(RECIPE, model=args.model, quad=args.quad, face_limit=args.faces)
    if not args.texture:
        options.update(texture=False, pbr=False)
        options.pop('texture_quality'), options.pop('texture_alignment')
    for item in args.option or []:
        key, separator, value = item.partition('=')
        if not separator:
            raise RuntimeError(f'--option needs key=value, got {item}')
        try:
            options[key] = json.loads(value)
        except ValueError:
            options[key] = value
    return options


class Client:
    def __init__(self, job, key):
        import requests  # Imported here so --dry-run and --help work without it.
        self.requests, self.job = requests, job
        self.auth = {'Authorization': 'Bearer ' + key, 'Accept': 'application/json'}

    def call(self, method, endpoint, receipt, **kwargs):
        # Redirects are not followed with credentials, and nothing is retried automatically.
        response = self.requests.request(method, BASE + endpoint, headers=self.auth, timeout=(15, 90), allow_redirects=False, **kwargs)
        try:
            body = response.json()
        except ValueError:
            self.job.save(receipt, {'httpStatus': response.status_code, 'nonJson': True})
            raise RuntimeError('Non-JSON API response; inspect the receipt in the job directory')
        self.job.save(receipt, {'httpStatus': response.status_code, 'response': body})
        if response.status_code != 200 or body.get('code') != 0:
            raise RuntimeError(f'API request failed: HTTP {response.status_code}, code {body.get("code")}')
        return body['data']


def prepare(job, args, client=None):
    sources = [(view, Path(getattr(args, view)).resolve()) for view in VIEWS if getattr(args, view)]
    if len(sources) < 2 or sources[0][0] != 'front':
        raise RuntimeError('Give --front and at least one of --left, --back, --right.')
    if not args.faces or args.expected_credits is None or not args.out or not args.name:
        raise RuntimeError('--faces, --expected-credits, --out and --name are required.')
    for view, path in sources:
        if path.suffix.lower() not in MIME or not path.is_file():
            raise RuntimeError(f'{view}: {path} is not a readable PNG, JPEG or WebP file')
    config = dict(sources=[dict(view=view, path=str(path), sha256=digest(path)) for view, path in sources],
                  options=build_options(args), expectedCredits=args.expected_credits, out=str(Path(args.out).resolve()), name=args.name)
    if args.dry_run:
        emit(dryRun=True, endpoint='/generation/multiview-to-model', expectedCredits=args.expected_credits,
             request=dict(config['options'], inputs=[{view: path.name} for view, path in sources]))
        return
    if job.path('job.json').exists() and job.read('job.json') != config:
        raise RuntimeError('This job directory already holds a different request. Use a new --job directory.')
    job.save('job.json', config)
    for source in config['sources']:
        receipt = f"upload-{source['view']}.json"
        if job.path(receipt).exists() and job.read(receipt).get('sha256') == source['sha256']:
            continue
        with open(source['path'], 'rb') as image:
            name = Path(source['path']).name
            uploaded = client.call('POST', '/files', f"upload-{source['view']}-raw.json", files={'file': (name, image, MIME[Path(name).suffix.lower()])})
        job.save(receipt, {'sha256': source['sha256'], 'file_token': uploaded['file_token']})
        emit(uploadedView=source['view'], originalUnchanged=True)
    inputs = [{source['view']: job.read(f"upload-{source['view']}.json")['file_token']} for source in config['sources']]
    job.save('request.json', dict(config['options'], inputs=inputs))
    emit(prepared=True, views=[source['view'] for source in config['sources']], expectedCredits=config['expectedCredits'])


def submit(job, client):
    if job.path('submission-started.json').exists():
        raise RuntimeError('This job was already submitted. Recover it with status or poll; do not submit it again.')
    config = job.read('job.json')
    for source in config['sources']:
        if digest(source['path']) != source['sha256']:
            raise RuntimeError(f"The {source['view']} reference changed since prepare. Prepare a new job.")
    balance = client.call('GET', '/account/balance', 'balance-at-submit.json')
    if balance['balance'] < config['expectedCredits']:
        raise RuntimeError(f"Balance {balance['balance']} is below the {config['expectedCredits']} credits expected. Nothing was submitted or purchased.")
    # An exclusive marker written before the POST survives a dropped connection, so a retry cannot double-charge.
    descriptor = os.open(job.path('submission-started.json'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as file:
        json.dump({'startedUtc': now(), 'expectedCredits': config['expectedCredits']}, file)
    data = client.call('POST', '/generation/multiview-to-model', 'submission-response.json', json=job.read('request.json'))
    job.save('task.json', {'task_id': data['task_id'], 'submittedUtc': now()})
    emit(submitted=True, taskId=data['task_id'], expectedCredits=config['expectedCredits'])


def status(job, client):
    task = client.call('GET', '/tasks/' + job.read('task.json')['task_id'], 'latest-task.json')
    emit(status=task['status'], progress=task.get('progress'), creditsConsumed=task.get('credits_consumed'))
    return task


def download(job, client):
    task = status(job, client)  # Result URLs expire; refresh them immediately before downloading.
    if task['status'] != 'success':
        raise RuntimeError('The task has not succeeded. Nothing was downloaded and nothing was resubmitted.')
    config, files = job.read('job.json'), []
    out = Path(config['out'])
    out.mkdir(parents=True, exist_ok=True)
    for key, suffix in [('model_url', None), ('rendered_image_url', '-provider-preview.png')]:
        url = task['output'].get(key)
        if not url:
            continue
        if not isinstance(url, str) or not url.startswith('https://'):
            raise RuntimeError('Unexpected asset URL format')
        response = client.requests.get(url, timeout=(15, 300))  # No API key is sent to asset hosts.
        if response.status_code != 200:
            raise RuntimeError(f'Asset download HTTP {response.status_code}; run download again')
        if suffix is None:
            suffix = next((extension for prefix, extension in SIGNATURES if response.content[:32].startswith(prefix)), None)
            if suffix is None:
                raise RuntimeError('Unrecognized model file signature; nothing was written')
        target = out / (config['name'] + suffix)
        if target.exists() and digest(target) != hashlib.sha256(response.content).hexdigest():
            raise RuntimeError(f'{target} already exists with different content. Move it or choose another --name; nothing was overwritten.')
        target.write_bytes(response.content)
        files.append({'file': str(target), 'bytes': target.stat().st_size, 'sha256': digest(target)})
    if not any(not item['file'].endswith('-provider-preview.png') for item in files):
        raise RuntimeError('The successful task did not provide a model file')
    balance = client.call('GET', '/account/balance', 'balance-after.json')
    job.save('downloaded.json', {'files': files, 'downloadedUtc': now()})
    emit(downloaded=files, creditsConsumed=task.get('credits_consumed'), balanceAfter=balance['balance'])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('action', choices=['prepare', 'submit', 'status', 'poll', 'download'])
    parser.add_argument('--job', required=True, help='private receipts directory for this one submission')
    for view in VIEWS:
        parser.add_argument('--' + view, help=f'accepted {view} view image')
    parser.add_argument('--model', default=RECIPE['model'])
    parser.add_argument('--faces', type=int, help='requested face count; a best-effort target')
    parser.add_argument('--quad', action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument('--texture', action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument('--option', action='append', help='extra request field as key=value (JSON value); repeatable')
    parser.add_argument('--expected-credits', type=int, help='credits this job should cost, from the current price list')
    parser.add_argument('--out', help='folder for the downloaded model')
    parser.add_argument('--name', help='base file name for the downloaded model')
    parser.add_argument('--env', help='env file holding TRIPO_API_KEY')
    parser.add_argument('--wait-min', type=float, default=10)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    job = Job(args.job)
    try:
        if args.action == 'prepare' and args.dry_run:
            return prepare(job, args)
        key = find_key(args.env)
        if not key:
            raise RuntimeError('TRIPO_API_KEY not found in the environment, --env, ./.env.tripo or ~/.config/mr-pak/tripo.env')
        client = Client(job, key)
        if args.action == 'prepare':
            prepare(job, args, client)
        elif args.action == 'submit':
            submit(job, client)
        elif args.action == 'status':
            status(job, client)
        elif args.action == 'download':
            download(job, client)
        else:
            end = time.monotonic() + args.wait_min * 60
            while True:
                task = status(job, client)
                if task['status'] == 'success':
                    return download(job, client)
                if task['status'] in ('failed', 'cancelled', 'banned') or time.monotonic() >= end:
                    return
                time.sleep(5)
    except RuntimeError as error:
        sys.exit(str(error))
    except Exception as error:  # Transport errors can carry signed URLs; report the type only.
        sys.exit(f'{type(error).__name__}: inspect the job directory and recover the task; never resubmit blindly.')


if __name__ == '__main__':
    main()
