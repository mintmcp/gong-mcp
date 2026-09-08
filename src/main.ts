import { DEFAULT_BASE_URL } from "./gong-client.js";
import { app } from "./server.js";

const PORT = parseInt(process.env.PORT || "8000", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Gong MCP server listening on 0.0.0.0:${PORT}/mcp`);
  console.log(`Gong API host: ${process.env.GONG_BASE_URL || DEFAULT_BASE_URL} (override with GONG_BASE_URL)`);
});
