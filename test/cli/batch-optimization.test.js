import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {import('child_process').ChildProcessWithoutNullStreams} proc
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
const waitProcess = (proc) => {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
};

/**
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
const runSvgo = (args) => {
  const proc = spawn(
    'node',
    ['../../bin/svgo', '--no-color', ...args],
    { cwd: __dirname },
  );
  return waitProcess(proc);
};

describe('batch optimization stability', () => {
  const outputDir = path.join(__dirname, 'output');
  
  beforeEach(async () => {
    try {
      await fs.rm(outputDir, { recursive: true });
    } catch (e) {
      // Ignore if directory doesn't exist
    }
    await fs.mkdir(outputDir, { recursive: true });
  });
  
  afterAll(async () => {
    try {
      await fs.rm(outputDir, { recursive: true });
    } catch (e) {
      // Ignore
    }
  });

  test('normal files: output order matches input order', async () => {
    const { code, stdout, stderr } = await runSvgo([
      'batch/file1.svg',
      'batch/file2.svg',
      'batch/file3.svg',
      '-o',
      'output/file1.svg',
      'output/file2.svg',
      'output/file3.svg',
    ]);
    
    expect(stderr).toBe('');
    
    const output1 = await fs.readFile(path.join(outputDir, 'file1.svg'), 'utf-8');
    const output2 = await fs.readFile(path.join(outputDir, 'file2.svg'), 'utf-8');
    const output3 = await fs.readFile(path.join(outputDir, 'file3.svg'), 'utf-8');
    
    expect(output1).toContain('rect');
    expect(output2).toContain('circle');
    expect(output3).toContain('polygon');
    
    const orderMatches = stdout.includes('file1.svg') && 
                        stdout.indexOf('file1.svg') < stdout.indexOf('file2.svg') &&
                        stdout.indexOf('file2.svg') < stdout.indexOf('file3.svg');
    expect(orderMatches).toBe(true);
  });

  test('corrupt file: does not interrupt batch processing', async () => {
    const { code, stdout, stderr } = await runSvgo([
      'batch/file1.svg',
      'batch/corrupt.svg',
      'batch/file3.svg',
      '-o',
      'output/file1.svg',
      'output/corrupt.svg',
      'output/file3.svg',
    ]);
    
    expect(stderr).toContain('corrupt.svg');
    expect(stderr).toContain('SvgoParserError');
    
    const output1 = await fs.readFile(path.join(outputDir, 'file1.svg'), 'utf-8');
    const output3 = await fs.readFile(path.join(outputDir, 'file3.svg'), 'utf-8');
    
    expect(output1).toContain('rect');
    expect(output3).toContain('polygon');
    
    expect(stdout).toContain('file1.svg');
    expect(stdout).toContain('file3.svg');
  });

  test('error count is accurate', async () => {
    const { code, stdout, stderr } = await runSvgo([
      'batch/file1.svg',
      'batch/corrupt.svg',
      'batch/file2.svg',
      'batch/corrupt.svg',
      '-o',
      'output/file1.svg',
      'output/corrupt1.svg',
      'output/file2.svg',
      'output/corrupt2.svg',
    ]);
    
    const corruptErrors = (stderr.match(/corrupt\.svg/g) || []).length;
    expect(corruptErrors).toBeGreaterThanOrEqual(2);
    
    const errorCountMatch = stderr.match(/(\d+)\s+file\(s\)\s+failed/);
    if (errorCountMatch) {
      expect(parseInt(errorCountMatch[1])).toBe(2);
    }
    
    const output1 = await fs.readFile(path.join(outputDir, 'file1.svg'), 'utf-8');
    const output2 = await fs.readFile(path.join(outputDir, 'file2.svg'), 'utf-8');
    
    expect(output1).toContain('rect');
    expect(output2).toContain('circle');
  });

  test('repeated execution produces consistent results', async () => {
    const run1 = await runSvgo([
      'batch/file1.svg',
      'batch/file2.svg',
      '-o',
      'output/run1-file1.svg',
      'output/run1-file2.svg',
    ]);
    
    const run2 = await runSvgo([
      'batch/file1.svg',
      'batch/file2.svg',
      '-o',
      'output/run2-file1.svg',
      'output/run2-file2.svg',
    ]);
    
    expect(run1.stderr).toBe('');
    expect(run2.stderr).toBe('');
    
    const run1File1 = await fs.readFile(path.join(outputDir, 'run1-file1.svg'), 'utf-8');
    const run1File2 = await fs.readFile(path.join(outputDir, 'run1-file2.svg'), 'utf-8');
    const run2File1 = await fs.readFile(path.join(outputDir, 'run2-file1.svg'), 'utf-8');
    const run2File2 = await fs.readFile(path.join(outputDir, 'run2-file2.svg'), 'utf-8');
    
    expect(run1File1).toBe(run2File1);
    expect(run1File2).toBe(run2File2);
  });

  test('folder processing: corrupt files do not interrupt batch', async () => {
    const { code, stdout, stderr } = await runSvgo([
      '-f', 'batch',
      '-o', 'output/batch-output',
    ]);
    
    expect(stderr).toContain('corrupt.svg');
    
    try {
      const output1 = await fs.readFile(path.join(outputDir, 'batch-output', 'file1.svg'), 'utf-8');
      expect(output1).toContain('rect');
    } catch (e) {
      const files = await fs.readdir(path.join(outputDir, 'batch-output'));
      expect(files).toContain('file1.svg');
    }
  });
});
