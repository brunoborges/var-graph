# var-graph

Live site: https://brunoborges.github.io/var-graph/

## Run locally

The app is fully static (`index.html`, `script.js`, `style.css`, plus the bundled
GIF encoder in `vendor/`). Serve it with the included Python script:

```bash
python3 serve.py          # serves at http://127.0.0.1:8000/ and opens a browser
python3 serve.py 8080     # use a custom port
python3 serve.py --no-browser
```

If the chosen port is already in use, the script automatically falls back to the
next free port and prints the URL it ended up on.

Requires Python 3 (no third-party dependencies).

## Export a GIF

Click **Generate** to build a graph, then **Export GIF** to download a looping
animated GIF of the sweep. The whole animation is deterministic, so frames are
rendered offline and encoded client-side with the bundled
[gif.js](https://github.com/jnordberg/gif.js) (in `vendor/`) — nothing is sent to
a server. Output is capped at 720px wide at 25 fps to keep file sizes reasonable.