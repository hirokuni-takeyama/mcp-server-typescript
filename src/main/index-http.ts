#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DataForSEOClient, DataForSEOConfig } from '../core/client/dataforseo.client.js';
import { SerpApiModule } from '../core/modules/serp/serp-api.module.js';
import { KeywordsDataApiModule } from '../core/modules/keywords-data/keywords-data-api.module.js';
import { OnPageApiModule } from '../core/modules/onpage/onpage-api.module.js';
import { DataForSEOLabsApi } from '../core/modules/dataforseo-labs/dataforseo-labs-api.module.js';
import { EnabledModulesSchema, isModuleEnabled, defaultEnabledModules } from '../core/config/modules.config.js';
import { BaseModule, ToolDefinition } from '../core/modules/base.module.js';
import { z } from 'zod';
import { BacklinksApiModule } from "../core/modules/backlinks/backlinks-api.module.js";
import { BusinessDataApiModule } from "../core/modules/business-data-api/business-data-api.module.js";
import { DomainAnalyticsApiModule } from "../core/modules/domain-analytics/domain-analytics-api.module.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request as ExpressRequest, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { GetPromptResult, isInitializeRequest, ReadResourceResult, ServerNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { name, version } from '../core/utils/version.js';
import { ModuleLoaderService } from "../core/utils/module-loader.js";
import { initializeFieldConfiguration } from '../core/config/field-configuration.js';
import { initMcpServer } from "./init-mcp-server.js";

// Initialize field configuration if provided
initializeFieldConfiguration();

// Extended request interface (元のまま残します)
interface Request extends ExpressRequest {
  username?: string;
  password?: string;
}

console.error('Starting DataForSEO MCP Server...');
console.error(`Server name: ${name}, version: ${version}`);

function getSessionId() {
  return randomUUID().toString();
}

async function main() {
  const app = express();
  app.use(express.json());

  // ===== Basic Auth Middleware（入場制御のみ） =====
  const BASIC_USER = process.env.BASIC_AUTH_USER || "";
  const BASIC_PASS = process.env.BASIC_AUTH_PASS || "";

  const basicAuth = (req: Request, res: Response, next: NextFunction) => {
    // 環境変数が未設定なら認証スキップ（開発・一時公開用）
    if (!BASIC_USER) return next();

    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="mcp"');
      return res.status(401).send("Authentication required");
    }
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [user, pass] = credentials.split(':');

    if (user === BASIC_USER && pass === BASIC_PASS) return next();

    res.setHeader('WWW-Authenticate', 'Basic realm="mcp"');
    return res.status(401).send("Invalid credentials");
  };

  // ===== MCP リクエストハンドラ =====
  const handleMcpRequest = async (req: Request, res: Response) => {
    // リクエスト毎に独立インスタンスで処理（元実装の方針を維持）
    try {
      // DataForSEO の資格情報は常に環境変数から取得（リクエストのBasicは使わない）
      const envUsername = process.env.DATAFORSEO_USERNAME;
      const envPassword = process.env.DATAFORSEO_PASSWORD;
      if (!envUsername || !envPassword) {
        console.error('No DataForSEO credentials provided in environment');
        return res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Server is not configured with DATAFORSEO credentials." },
          id: null
        });
      }

      const server = initMcpServer(envUsername, envPassword);

      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      req.on('close', () => {
        transport.close();
        server.close();
      });

    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  };

  const handleNotAllowed = (method: string) => async (req: Request, res: Response) => {
    console.error(`Received ${method} request`);
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null
    });
  };

  // Apply basic auth and shared handler to both endpoints
  app.post('/http', basicAuth, handleMcpRequest);
  app.post('/mcp',  basicAuth, handleMcpRequest);

  app.get('/http', handleNotAllowed('GET HTTP'));
  app.get('/mcp',  handleNotAllowed('GET MCP'));

  app.delete('/http', handleNotAllowed('DELETE HTTP'));
  app.delete('/mcp',  handleNotAllowed('DELETE MCP'));

  // （任意）/health を追加しておくと監視が楽
  app.get('/health', (_req, res) => res.status(200).send('OK'));

  // Start the server
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  app.listen(PORT, () => {
    console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
  });
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
