import { spawn } from 'child_process';
import { data } from 'react-router-dom';

const child = spawn('python', ['-V'], {
    env: {...process.env}
});

child.stdout.on('data', (data) => {
    console.log('STDOUT:', data.toString())
});

child.stderr.on('data', (data) => {
    console.error('STDERR:', data.toString());
});

child.on('close', (code) => {
    console.log('Exit code:', code)
})