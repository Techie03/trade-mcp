import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execPromise = promisify(exec);

export function registerPythonTools(server: McpServer): void {
  
  server.tool(
    'run_python_analysis',
    `Execute dynamic Python code for financial analysis, quantitative backtesting, calculations, or generating charts/plots.
    The code will be executed in a dedicated 'analysis' folder inside the project.
    Standard libraries like pandas, numpy, and matplotlib are fully supported.
    Any files generated (such as PNG charts or CSV files) will be saved in the 'analysis' folder.`,
    {
      code: z.string().describe('The Python code to execute. Can write files (e.g. plt.savefig("plot.png")) in the current working directory.'),
    },
    async ({ code }) => {
      const workspaceRoot = process.cwd();
      const analysisDir = path.join(workspaceRoot, 'analysis');

      // Ensure analysis directory exists
      if (!fs.existsSync(analysisDir)) {
        fs.mkdirSync(analysisDir, { recursive: true });
      }

      // Generate a unique script filename
      const scriptId = Date.now();
      const scriptName = `run_${scriptId}.py`;
      const scriptPath = path.join(analysisDir, scriptName);

      // Write code to file
      fs.writeFileSync(scriptPath, code, 'utf8');

      // Snapshot files before execution to find new outputs
      const beforeFiles = new Set(fs.readdirSync(analysisDir));

      try {
        // Run Python script
        // Note: Running in analysisDir context so relative paths save there
        const { stdout, stderr } = await execPromise(`python "${scriptName}"`, {
          cwd: analysisDir,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
          },
          timeout: 60000, // 1 minute execution limit
        });

        // Clean up script file
        try {
          fs.unlinkSync(scriptPath);
        } catch (_) {}

        // Identify newly created files (plots, data files, etc.)
        const afterFiles = fs.readdirSync(analysisDir);
        const newFiles = afterFiles.filter(file => !beforeFiles.has(file) && file !== scriptName);

        const response = {
          success: true,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          generatedFiles: newFiles.map(file => `analysis/${file}`),
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (err: any) {
        // Clean up script file in case of error
        try {
          if (fs.existsSync(scriptPath)) {
            fs.unlinkSync(scriptPath);
          }
        } catch (_) {}

        const response = {
          success: false,
          stdout: err.stdout ? err.stdout.trim() : '',
          stderr: err.stderr ? err.stderr.trim() : err.message,
          exitCode: err.code ?? 1,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      }
    }
  );
}
