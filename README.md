# enquadrebot
Robot de búsqueda

Instrucciones de instalación
```bash
1. npm install
2. brew install chromium
```

Ejecutar
```bash
1. node index.js
```

Editar .env
1. Visualizar en finder:
```bash
command + shift + .
```
2. Editar en terminal
```bash
ls -a
nano .env
```

```bash
EC2 (Node.js)
│
├── scraper/
│   ├── linkedinBot.js
│   ├── keywords.js
│   ├── seen.json
│   └── cookies.json
│
├── services/
│   ├── mailer.js
│   └── storage.js
│
├── scheduler/
│   └── cron.js
│
└── index.js
```