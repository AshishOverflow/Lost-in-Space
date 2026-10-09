import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import fs from 'fs'
import path from 'path'

function missionDatabasePlugin(): Plugin {
  return {
    name: 'mission-database-server',
    configureServer(server) {
      server.middlewares.use('/api/database/log', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const record = JSON.parse(body);
          const dbFile = path.resolve(process.cwd(), 'src/database/missions.json');
              let records: any[] = [];
              if (fs.existsSync(dbFile)) {
                try {
                  const content = fs.readFileSync(dbFile, 'utf-8');
                  records = JSON.parse(content);
                  if (!Array.isArray(records)) records = [];
                } catch {
                  records = [];
                }
              }
              records.push(record);
              fs.writeFileSync(dbFile, JSON.stringify(records, null, 2), 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ success: true, count: records.length, record }));
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else if (req.method === 'GET') {
          const dbFile = path.resolve(process.cwd(), 'src/database/missions.json');
          res.setHeader('Content-Type', 'application/json');
          if (fs.existsSync(dbFile)) {
            res.statusCode = 200;
            res.end(fs.readFileSync(dbFile, 'utf-8'));
          } else {
            res.statusCode = 200;
            res.end('[]');
          }
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), missionDatabasePlugin()],
})
