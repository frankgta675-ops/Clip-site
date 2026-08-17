const express = require("express");
const multer = require("multer");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, "uploads");
const CLIPS_DIR = path.join(__dirname, "public", "clips");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(CLIPS_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });

app.use(express.static(path.join(__dirname, "public")));

// Simple in-memory job tracker (fine for one person using it)
const jobs = {};

app.post("/upload", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No video uploaded" });

  const clipLength = parseInt(req.body.clipLength) || 30;
  const jobId = Date.now().toString();
  const jobFolder = path.join(CLIPS_DIR, jobId);
  fs.mkdirSync(jobFolder, { recursive: true });

  jobs[jobId] = { status: "processing", clips: [] };
  res.json({ jobId });

  const inputPath = req.file.path;
  const outputPattern = path.join(jobFolder, "clip%03d.mp4");

  // Cuts the video into fixed-length segments AND reformats each
  // segment to vertical (1080x1920) with black bars so nothing
  // gets cropped out, similar to how short-form clippers reformat
  // landscape footage.
  const args = [
    "-i", inputPath,
    "-vf", "scale=1080:-2:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-c:a", "aac",
    "-f", "segment",
    "-segment_time", String(clipLength),
    "-reset_timestamps", "1",
    outputPattern
  ];

  const ffmpeg = spawn("ffmpeg", args);

  ffmpeg.stderr.on("data", () => {}); // ffmpeg logs progress to stderr; ignored here

  ffmpeg.on("close", (code) => {
    fs.unlink(inputPath, () => {});
    if (code !== 0) {
      jobs[jobId].status = "error";
      return;
    }
    const files = fs.readdirSync(jobFolder).sort();
    jobs[jobId].clips = files.map((f) => `/clips/${jobId}/${f}`);
    jobs[jobId].status = "done";
  });
});

app.get("/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
