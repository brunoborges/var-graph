# var-graph

Live site: https://brunoborges.github.io/var-graph/

## Run locally

The app is fully static (`index.html`, `script.js`, `style.css`). Serve it with the
included Python script:

```bash
python3 serve.py          # serves at http://127.0.0.1:8000/ and opens a browser
python3 serve.py 8080     # use a custom port
python3 serve.py --no-browser
```

If the chosen port is already in use, the script automatically falls back to the
next free port and prints the URL it ended up on.

Requires Python 3 (no third-party dependencies).