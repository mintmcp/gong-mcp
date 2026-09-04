import { app } from "./server.js";

const PORT = parseInt(process.env.PORT || "8000", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Gong MCP server listening on 0.0.0.0:${PORT}/mcp`);
});
