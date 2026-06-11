import { spawn } from "child_process";

export async function getYouTubeStreamUrl(input: string): Promise<string> {
  let url = input.trim();
  if (!url.startsWith("http")) {
    if (url.startsWith("@")) {
      url = `https://www.youtube.com/${url}/live`;
    } else if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
      url = `https://www.youtube.com/watch?v=${url}`;
    } else {
      url = `https://www.youtube.com/@${url}/live`;
    }
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", [
      "--no-playlist",
      "--no-live-from-start",
      "-f", "best[protocol^=m3u8]/best[ext=mp4]/best",
      "--get-url",
      "--no-warnings",
      "--no-check-certificate",
      "--socket-timeout", "15",
      url,
    ]);

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error("Timeout fetching YouTube stream URL (30s). Is the channel live?"));
    }, 30000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const lines = stdout.trim().split("\n").filter((l) => l.startsWith("http"));
      const streamUrl = lines[0];
      if (code === 0 && streamUrl) {
        resolve(streamUrl);
      } else {
        const errMsg = stderr.trim().slice(0, 500);
        reject(new Error(
          errMsg
            ? `yt-dlp: ${errMsg}`
            : "Could not get YouTube stream URL. Is the channel live? Make sure yt-dlp is installed."
        ));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new Error(
          "yt-dlp is not installed.\n" +
          "Install it with:  pip install yt-dlp\n" +
          "Or on Linux:  sudo apt install yt-dlp"
        ));
      } else {
        reject(err);
      }
    });
  });
}
