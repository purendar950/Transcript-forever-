export const LANDING_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>YouTube Transcript API</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #0d1117;
         color: #c9d1d9; margin: 0; padding: 2.5rem 1.25rem; line-height: 1.6; }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { color: #58a6ff; margin-bottom: 0.25rem; font-size: 1.6rem; }
  h2 { color: #e6edf3; font-size: 1.05rem; margin-top: 2rem; }
  p.lead { color: #8b949e; margin-top: 0; }
  code, pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px;
              font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; }
  code { padding: 0.1rem 0.35rem; color: #ffa657; }
  pre { padding: 0.85rem; overflow-x: auto; }
  pre code { background: none; border: none; padding: 0; color: #c9d1d9; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-weight: 600; }
  a { color: #58a6ff; }
  form { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; }
  input, select, button { background: #161b22; color: #c9d1d9; border: 1px solid #30363d;
                          border-radius: 6px; padding: 0.5rem 0.7rem; font-size: 0.9rem; }
  input { flex: 1 1 18rem; }
  button { background: #238636; border-color: #2ea043; color: #fff; cursor: pointer; }
  button:hover { background: #2ea043; }
  #output { white-space: pre-wrap; margin-top: 0.9rem; max-height: 22rem; overflow-y: auto; }
</style>
</head>
<body>
<main>
  <h1>YouTube Transcript API</h1>
  <p class="lead">Free, keyless transcripts for any public YouTube video with captions.</p>

  <h2>Try it</h2>
  <form id="demo">
    <label class="sr-only" for="video-url">YouTube URL or video id</label>
    <input id="video-url" name="url" value="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
           placeholder="YouTube URL or video id" required />
    <label class="sr-only" for="format">Format</label>
    <select id="format" name="format">
      <option value="plain">plain</option>
      <option value="json">json</option>
      <option value="timestamps">timestamps</option>
      <option value="paragraphs">paragraphs</option>
      <option value="srt">srt</option>
      <option value="vtt">vtt</option>
    </select>
    <button type="submit">Get transcript</button>
  </form>
  <pre id="output" aria-live="polite">Response appears here.</pre>

  <h2>Endpoints</h2>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead>
    <tbody>
      <tr><td>GET / POST</td><td><code>/api/transcript</code></td><td>Transcript in any format</td></tr>
      <tr><td>GET</td><td><code>/api/languages</code></td><td>Caption tracks for a video</td></tr>
      <tr><td>GET</td><td><code>/api/formats</code></td><td>Supported formats</td></tr>
      <tr><td>GET</td><td><code>/api/health</code></td><td>Health probe</td></tr>
    </tbody>
  </table>

  <h2>Parameters</h2>
  <table>
    <thead><tr><th>Name</th><th>Default</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>url</code></td><td>—</td><td>Video URL or 11-char id (required)</td></tr>
      <tr><td><code>format</code></td><td><code>json</code></td><td>json, plain, timestamps, paragraphs, srt, vtt</td></tr>
      <tr><td><code>lang</code></td><td><code>en</code></td><td>Comma-separated priority list, e.g. <code>hi,en</code></td></tr>
      <tr><td><code>raw</code></td><td><code>false</code></td><td><code>true</code> returns the bare body, no JSON wrapper</td></tr>
    </tbody>
  </table>

  <h2>Examples</h2>
  <pre><code>curl "$ORIGIN/api/transcript?url=dQw4w9WgXcQ&format=plain"

curl -X POST "$ORIGIN/api/transcript" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://youtu.be/dQw4w9WgXcQ","format":"srt","lang":"en"}'

curl "$ORIGIN/api/transcript?url=dQw4w9WgXcQ&format=srt&raw=true" -o captions.srt</code></pre>
</main>
<script>
  const origin = location.origin;
  for (const node of document.querySelectorAll("pre code")) {
    node.textContent = node.textContent.replaceAll("$ORIGIN", origin);
  }
  const form = document.getElementById("demo");
  const output = document.getElementById("output");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const params = new URLSearchParams({ url: data.get("url"), format: data.get("format") });
    output.textContent = "Loading...";
    try {
      const response = await fetch(origin + "/api/transcript?" + params);
      const body = await response.json();
      output.textContent = typeof body.transcript === "string"
        ? body.transcript
        : JSON.stringify(body, null, 2);
    } catch (error) {
      output.textContent = "Request failed: " + error.message;
    }
  });
</script>
</body>
</html>`;
