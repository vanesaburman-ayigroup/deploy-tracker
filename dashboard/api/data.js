export default async function handler(req, res) {
    const { file } = req.query;
    const allowed = ["deploy-queue.json", "config.json", "notification-log.json"];
  
    if (!file || !allowed.includes(file)) {
      return res.status(400).json({ error: "Invalid file parameter" });
    }
  
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO || "vanesaburman-ayigroup/deploy-tracker";
  
    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/contents/data/${file}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3.raw",
          },
        }
      );
  
      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: err });
      }
  
      const data = await response.json();
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }