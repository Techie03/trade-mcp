import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execPromise = promisify(exec);

/**
 * Validates Python code statically using Python's AST module to prevent RCE.
 */
function validatePythonCode(code: string): Promise<{ valid: boolean; error?: string }> {
  return new Promise((resolve) => {
    const validatorScript = `
import ast, sys

def validate(code_str):
    try:
        tree = ast.parse(code_str)
    except SyntaxError as e:
        return f"Syntax Error: {e}"

    ALLOWED_MODULES = {'pandas', 'numpy', 'matplotlib', 'matplotlib.pyplot', 'math', 'json', 'datetime', 'scipy'}
    BANNED_NAMES = {
        'open', 'eval', 'exec', 'compile', '__import__', 'globals', 'locals', 
        'getattr', 'setattr', 'delattr', 'hasattr', 'os', 'sys', 'subprocess', 
        'shutil', 'socket', 'urllib', 'requests', 'pty', 'platform', 'builtins',
        'input', 'breakpoint', 'help'
    }

    for node in ast.walk(tree):
        # 1. Check imports
        if isinstance(node, ast.Import):
            for alias in node.names:
                base_module = alias.name.split('.')[0]
                if base_module not in ALLOWED_MODULES:
                    return f"Import of module '{alias.name}' is not allowed."
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                base_module = node.module.split('.')[0]
                if base_module not in ALLOWED_MODULES:
                    return f"Import from module '{node.module}' is not allowed."
            else:
                return "Relative imports are not allowed."
        
        # 2. Check names
        if isinstance(node, ast.Name):
            if node.id in BANNED_NAMES:
                return f"Use of name '{node.id}' is blocked for security reasons."
            if node.id.startswith('__'):
                return "Use of double-underscore names is blocked."
        
        # 3. Check attributes
        if isinstance(node, ast.Attribute):
            if node.attr.startswith('__') or node.attr in BANNED_NAMES:
                return f"Accessing attribute '{node.attr}' is blocked."

        # 4. Check string literals for directory traversal or absolute paths
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            val = node.value
            if '..' in val or val.startswith('/') or val.startswith('\\\\') or (len(val) > 1 and val[1] == ':'):
                return f"Path traversal or absolute path '{val}' is not allowed in string literals."
        elif hasattr(ast, 'Str') and isinstance(node, ast.Str):
            val = node.s
            if '..' in val or val.startswith('/') or val.startswith('\\\\') or (len(val) > 1 and val[1] == ':'):
                return f"Path traversal or absolute path '{val}' is not allowed in string literals."

    return None

if __name__ == '__main__':
    code = sys.stdin.read()
    err = validate(code)
    if err:
        print(err)
        sys.exit(1)
    sys.exit(0)
`;

    const py = spawn('python', ['-c', validatorScript]);
    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    py.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    py.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve({ valid: true });
      } else {
        resolve({
          valid: false,
          error: (stdout || stderr || 'Validation failed').trim(),
        });
      }
    });

    py.stdin.write(code);
    py.stdin.end();
  });
}

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
      const validation = await validatePythonCode(code);
      if (!validation.valid) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                stdout: '',
                stderr: `Security Validation Error: ${validation.error}`,
                exitCode: 1,
              }, null, 2),
            },
          ],
        };
      }

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
