import { registerPythonTools } from './dist/tools/python.js';

async function runSecurityTests() {
  let handler;
  const mockServer = {
    tool: (name, desc, schema, fn) => {
      if (name === 'run_python_analysis') handler = fn;
    }
  };
  registerPythonTools(mockServer);

  const testCases = [
    {
      name: 'Attempt RCE via subprocess',
      code: `
import subprocess
subprocess.run(['echo', 'hello'])
`,
      expectBlock: true,
      errorMatch: "Import of module 'subprocess' is not allowed"
    },
    {
      name: 'Attempt RCE via os module',
      code: `
import os
os.system('whoami')
`,
      expectBlock: true,
      errorMatch: "Import of module 'os' is not allowed"
    },
    {
      name: 'Attempt using banned builtin "open"',
      code: `
with open('/etc/passwd', 'r') as f:
    print(f.read())
`,
      expectBlock: true,
      errorMatch: "Use of name 'open' is blocked for security reasons"
    },
    {
      name: 'Attempt dunder attribute escape (__class__)',
      code: `
x = 42
print(x.__class__.__base__)
`,
      expectBlock: true,
      errorMatch: "is blocked"
    },
    {
      name: 'Attempt path traversal in string literal',
      code: `
import pandas as pd
df = pd.DataFrame({'a': [1]})
df.to_csv('../sensitive.csv')
`,
      expectBlock: true,
      errorMatch: "Path traversal or absolute path '../sensitive.csv' is not allowed"
    },
    {
      name: 'Attempt path traversal with backslash',
      code: `
import pandas as pd
df = pd.DataFrame({'a': [1]})
df.to_csv('..\\\\sensitive.csv')
`,
      expectBlock: true,
      errorMatch: "Path traversal or absolute path '..\\sensitive.csv' is not allowed"
    },
    {
      name: 'Attempt absolute path with drive letter',
      code: `
import pandas as pd
df = pd.DataFrame({'a': [1]})
df.to_csv('C:/windows/system32')
`,
      expectBlock: true,
      errorMatch: "Path traversal or absolute path 'C:/windows/system32' is not allowed in string literals"
    },
    {
      name: 'Allowed pandas and numpy code',
      code: `
import pandas as pd
import numpy as np
df = pd.DataFrame({'a': [1, 2, 3]})
print("SUM:", df['a'].sum())
`,
      expectBlock: false,
    }
  ];

  console.log('--- Running Security Tests ---');
  let passCount = 0;

  for (const tc of testCases) {
    try {
      const response = await handler({ code: tc.code });
      const result = JSON.parse(response.content[0].text);

      if (tc.expectBlock) {
        if (!result.success && result.stderr.includes('Security Validation Error')) {
          if (tc.errorMatch && !result.stderr.includes(tc.errorMatch)) {
            console.log(`❌ FAIL: ${tc.name}`);
            console.log(`   Expected error match: "${tc.errorMatch}"`);
            console.log(`   Got: "${result.stderr}"`);
          } else {
            console.log(`✅ PASS: ${tc.name} (Successfully blocked: ${result.stderr.trim().split('\n')[0]})`);
            passCount++;
          }
        } else {
          console.log(`❌ FAIL: ${tc.name}`);
          console.log(`   Expected to be blocked, but succeeded or got different error:`, result);
        }
      } else {
        if (result.success && result.stdout.includes('SUM: 6')) {
          console.log(`✅ PASS: ${tc.name}`);
          passCount++;
        } else {
          console.log(`❌ FAIL: ${tc.name}`);
          console.log(`   Expected success, but failed:`, result);
        }
      }
    } catch (e) {
      console.log(`❌ FAIL: ${tc.name} with exception:`, e);
    }
  }

  console.log(`--------------------------------`);
  console.log(`Security Test Results: ${passCount}/${testCases.length} passed.`);
  if (passCount !== testCases.length) {
    process.exit(1);
  }
}

runSecurityTests();
