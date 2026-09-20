// Minimal RESP server - GET/SET(EX)/DEL/INCR/EXPIRE/TTL/PING/INFO.
// Tracks TTLs so tests can assert on cache clamping.
const net = require('net');

function createMiniRedis() {
    const store = new Map();
    const ttls = new Map();
    store.ttls = ttls;

    const enc = {
        simple: s => `+${s}\r\n`,
        int: n => `:${n}\r\n`,
        bulk: s => (s === null ? '$-1\r\n' : `$${Buffer.byteLength(s)}\r\n${s}\r\n`)
    };

    function handle(args) {
        const cmd = args[0].toUpperCase();
        switch (cmd) {
            case 'PING': return enc.simple('PONG');
            case 'INFO': return enc.bulk('# Server\r\nredis_version:7.0.0\r\n');
            case 'GET': { const v = store.get(args[1]); return enc.bulk(v === undefined ? null : String(v)); }
            case 'SET': {
                store.set(args[1], args[2]);
                // SET key val EX <seconds>
                const exIdx = args.findIndex(a => String(a).toUpperCase() === 'EX');
                if (exIdx > -1 && args[exIdx + 1]) ttls.set(args[1], Number(args[exIdx + 1]));
                return enc.simple('OK');
            }
            case 'DEL': {
                let n = 0;
                for (const k of args.slice(1)) { if (store.delete(k)) n++; ttls.delete(k); }
                return enc.int(n);
            }
            case 'INCR': { const v = (Number(store.get(args[1])) || 0) + 1; store.set(args[1], String(v)); return enc.int(v); }
            case 'EXPIRE': {
                if (!store.has(args[1])) return enc.int(0);
                ttls.set(args[1], Number(args[2]));
                return enc.int(1);
            }
            case 'TTL': return enc.int(ttls.has(args[1]) ? ttls.get(args[1]) : -1);
            case 'QUIT': return enc.simple('OK');
            default: return enc.simple('OK');
        }
    }

    const server = net.createServer(sock => {
        let buf = '';
        sock.on('data', d => {
            buf += d.toString();
            for (;;) {
                if (!buf.startsWith('*')) break;
                const lines = buf.split('\r\n');
                const n = parseInt(lines[0].slice(1), 10);
                const needed = 1 + n * 2;
                if (lines.length - 1 < needed) break;
                const args = [];
                for (let i = 0; i < n; i++) args.push(lines[2 + i * 2]);
                buf = lines.slice(needed).join('\r\n');
                sock.write(handle(args));
            }
        });
        sock.on('error', () => {});
    });

    return { server, store, ttls };
}

module.exports = { createMiniRedis };
