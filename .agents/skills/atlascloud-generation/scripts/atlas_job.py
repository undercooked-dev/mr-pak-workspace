"""Portable AtlasCloud job helper. Dry runs never load credentials or use the network."""
import argparse
import hashlib
import json
import mimetypes
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import urlopen

BASE_URL = "https://api.atlascloud.ai/api/v1"
ENDPOINTS = {"image": "/model/generateImage", "video": "/model/generateVideo",
             "audio": "/model/generateAudio"}
SUCCESS = {"completed", "succeeded"}
FAILURE = {"failed", "error", "canceled", "cancelled", "timeout"}


def prediction(response):
    if not isinstance(response, dict):
        raise ValueError("Expected a JSON object from AtlasCloud.")
    data = response.get("data", response)
    if not isinstance(data, dict):
        raise ValueError("Expected an AtlasCloud prediction object.")
    return data


def task_status(data):
    return str(data.get("status", "unknown")).lower()


class AtlasClient:
    def __init__(self, key, transport=None):
        if transport is None:
            import requests
            transport = requests
        self.transport = transport
        self.headers = {"Authorization": f"Bearer {key}"}

    def request(self, method, endpoint, **kwargs):
        # Never retry POSTs: the provider may have accepted a billable task.
        response = self.transport.request(method, BASE_URL + endpoint,
                                          headers=self.headers, timeout=60,
                                          allow_redirects=False, **kwargs)
        payload = response.json()
        data = prediction(payload)
        # AtlasCloud can return a terminal prediction inside HTTP 5xx.
        if method == "GET" and task_status(data) in FAILURE:
            return payload
        if not 200 <= response.status_code < 300:
            raise RuntimeError(f"AtlasCloud HTTP {response.status_code}; preserve the receipt.")
        if payload.get("code") not in (None, 0, 200):
            raise RuntimeError("AtlasCloud reported an API error; inspect account history.")
        return payload

    def submit(self, kind, model, inputs):
        return self.request("POST", ENDPOINTS[kind], json={"model": model, **inputs})

    def status(self, prediction_id):
        return self.request("GET", "/model/prediction/" + quote(prediction_id, safe=""))

    def upload_file(self, source):
        media_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        with source.open("rb") as stream:
            return self.request("POST", "/model/uploadMedia",
                                files={"file": (source.name, stream, media_type)})


def now():
    return datetime.now(timezone.utc).isoformat()


def read_json(file):
    return json.loads(Path(file).read_text(encoding="utf-8"))


def save_json(file, value, exclusive=False):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    if exclusive:
        with file.open("x", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
    else:
        temporary = file.with_name(file.name + ".tmp")
        temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(file)


def client(env_file=None):
    key = os.environ.get("ATLASCLOUD_API_KEY")
    env_file = Path(env_file) if env_file else Path.cwd() / ".env"
    if not key and env_file.is_file():
        from dotenv import dotenv_values
        key = dotenv_values(env_file).get("ATLASCLOUD_API_KEY")
    if not key:
        raise ValueError("Set ATLASCLOUD_API_KEY in the environment or selected env file.")
    key = re.sub(r"^Bearer\s+", "", key.strip(), flags=re.I)
    if not key or "\n" in key or "\r" in key:
        raise ValueError("Invalid AtlasCloud credential format.")
    return AtlasClient(key)


def submit(args, api=None):
    inputs = read_json(args.input)
    if not isinstance(inputs, dict):
        raise ValueError("The model input file must contain a JSON object.")
    if "model" in inputs:
        raise ValueError("Select the model with --model; omit model from the input file.")
    if not args.model.strip():
        raise ValueError("An exact model ID is required.")
    if any(inputs.get(field) for field in ("enable_sync_mode", "enable_base64_output")):
        raise ValueError("This helper supports asynchronous URL outputs only.")
    if args.dry_run:
        return {"dry_run": True, "model": args.model, "endpoint": ENDPOINTS[args.kind],
                "input_fields": sorted(inputs), "live_schema_checked": False}
    if "example.invalid" in json.dumps(inputs):
        raise ValueError("Replace example reference URLs with actual uploads before submitting.")
    receipt = Path(args.out) / "job.json"
    if receipt.exists():
        raise ValueError("A job receipt already exists here. Use status/result to continue it.")
    api = api or client(args.env)
    job = {"provider": "atlascloud", "model": args.model, "kind": args.kind,
           "endpoint": ENDPOINTS[args.kind], "input": inputs,
           "created_at": now(), "status": "submission_pending"}
    # Exclusive creation prevents two helper processes from submitting into the same task.
    save_json(receipt, job, exclusive=True)
    try:
        response = api.submit(args.kind, args.model, inputs)
        data = prediction(response)
        prediction_id = data.get("id")
        if not isinstance(prediction_id, str) or not prediction_id.strip():
            raise ValueError("Submission response has no prediction ID.")
        job.update(prediction_id=prediction_id, status=task_status(data))
        if isinstance(data.get("urls"), dict):
            job["urls"] = data["urls"]
        save_json(receipt, job)
        if task_status(data) in SUCCESS | FAILURE:
            save_json(receipt.parent / "result.json", response)
    except Exception as error:
        # Keep the guard even when the network response or receipt write failed.
        job.update(status="submission_unknown", error_type=type(error).__name__)
        save_json(receipt, job)
        raise RuntimeError("Submission outcome is unknown. Inspect account history before resubmitting.") from None
    return {"status": job["status"], "prediction_id": job["prediction_id"], "receipt": str(receipt)}


def media_urls(value):
    # Call only on prediction.outputs, never on the full response or input URLs.
    if isinstance(value, dict):
        if isinstance(value.get("url"), str):
            if value["url"].startswith(("https://", "http://")):
                yield value
        else:
            for item in value.values():
                yield from media_urls(item)
    elif isinstance(value, list):
        for item in value:
            yield from media_urls(item)
    elif isinstance(value, str) and value.startswith(("https://", "http://")):
        yield {"url": value}


def download_result(result, folder):
    saved, seen = [], set()
    folder.mkdir(parents=True, exist_ok=True)
    for item in media_urls(prediction(result).get("outputs", [])):
        url = item["url"]
        if url in seen:
            continue
        seen.add(url)
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Media downloads require an HTTPS URL without embedded credentials.")
        suffix = Path(parsed.path).suffix.lower()
        if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
            suffix = mimetypes.guess_extension(item.get("content_type", "")) or ".bin"
        name = f"{len(saved)+1:02d}-{hashlib.sha256(url.encode()).hexdigest()[:10]}{suffix}"
        destination = folder / name
        if not destination.is_file():
            partial = destination.with_name(destination.name + ".part")
            size = 0
            with urlopen(url, timeout=60) as response, partial.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > 512 * 1024 * 1024:
                        raise ValueError("Media exceeds the helper's 512 MB per-file limit; download it separately.")
                    output.write(chunk)
            partial.replace(destination)
        saved.append({"path": str(destination), "bytes": destination.stat().st_size,
                      "kind": item.get("map_type") or item.get("file_name") or "media"})
    return saved


def resume(args, api=None):
    receipt = Path(args.job)
    job = read_json(receipt)
    if job.get("provider") != "atlascloud":
        raise ValueError("This helper requires an AtlasCloud receipt; use the original provider for other jobs.")
    if not job.get("prediction_id") or not job.get("model"):
        raise ValueError("Receipt has no prediction ID/model. Recover it from account history before continuing.")
    result_file = receipt.parent / "result.json"
    # A saved result remains useful after provider queue history has expired.
    if args.command == "result" and result_file.exists() and not args.refresh:
        result = read_json(result_file)
    else:
        api = api or client(args.env)
        result = api.status(job["prediction_id"])
    data = prediction(result)
    if data.get("id") and data["id"] != job["prediction_id"]:
        raise ValueError("Prediction ID does not match the receipt.")
    status = task_status(data)
    job.update(status=status, checked_at=now())
    save_json(receipt, job)
    if status in SUCCESS | FAILURE or data.get("error") or result.get("error"):
        save_json(result_file, result)
    if status in FAILURE or data.get("error") or result.get("error"):
        job.update(status=status if status in FAILURE else "provider_error")
        save_json(receipt, job)
        raise RuntimeError("Provider returned an error. Inspect the saved result; do not mark this job accepted.")
    if args.command == "status" or status not in SUCCESS:
        return {"status": status, "prediction_id": job["prediction_id"]}
    outputs = download_result(result, receipt.parent / "assets")
    job.update(status="downloaded" if outputs else "result_saved", outputs=outputs)
    save_json(receipt, job)
    return {"status": job["status"], "outputs": outputs, "result": str(result_file), "review": "pending"}


def upload(args, api=None):
    source = Path(args.file)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    receipt = Path(args.out)
    if receipt.exists():
        previous = read_json(receipt)
        if previous.get("sha256") == digest and previous.get("url"):
            return {"reused": True, "receipt": str(receipt)}
        raise ValueError("Upload receipt belongs to another file. Choose a new output path.")
    api = api or client(args.env)
    response = api.upload_file(source)
    data = prediction(response)
    url = data.get("download_url") or data.get("url") or response.get("url")
    if not isinstance(url, str) or urlparse(url).scheme != "https":
        raise ValueError("Upload response has no HTTPS URL.")
    save_json(receipt, {"provider": "atlascloud", "url": url, "source_name": source.name,
                        "sha256": digest, "created_at": now()}, exclusive=True)
    return {"uploaded": True, "receipt": str(receipt)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", help="Explicit .env file; otherwise use only the current directory's .env")
    commands = parser.add_subparsers(dest="command", required=True)
    send = commands.add_parser("submit", help="Start one requested generation, or validate inputs with --dry-run")
    send.add_argument("--kind", choices=ENDPOINTS, required=True, help="Use image for supported 3D models")
    send.add_argument("--model", required=True)
    send.add_argument("--input", required=True)
    send.add_argument("--out", required=True)
    send.add_argument("--dry-run", action="store_true")
    for name in ("status", "result"):
        command = commands.add_parser(name)
        command.add_argument("--job", required=True)
        command.add_argument("--refresh", action="store_true", help="Refresh the same prediction's saved result")
    up = commands.add_parser("upload", help="Upload a local reference; save its URL without printing it")
    up.add_argument("--file", required=True)
    up.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        result = submit(args) if args.command == "submit" else upload(args) if args.command == "upload" else resume(args)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ValueError, FileExistsError, FileNotFoundError, RuntimeError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
    except Exception as error:
        # Exception bodies can contain signed URLs or other private request details.
        print(json.dumps({"error": "Operation failed; preserve the receipt and inspect the provider status.", "type": type(error).__name__}), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
