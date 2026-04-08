import { searchPosts } from '@celeria-ai/linkedin-mcp';
import fs from 'fs/promises';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

// Leer cookies del archivo existente
const cookiesFile = await fs.readFile('./scraper/cookies.json', 'utf-8');
const cookies = JSON.parse(cookiesFile);

// Extraer el valor de li_at (cookie principal de LinkedIn)
const liAt = cookies.find(c => c.name === 'li_at')?.value;

if (!liAt) {
  console.error('❌ No se encontró cookie li_at');
  process.exit(1);
}

// Buscar posts por keywords
const results = await searchPosts({
  query: 'programador OR developer OR ingeniero OR software',
  limit: 100
});

console.log(`📦 Posts encontrados: ${results.length}`);

// Filtrar por tus keywords personalizadas
const seen = await getSeen();
const newPosts = results.filter(post => 
  !seen.includes(post.urn) && 
  KEYWORDS.some(k => post.content.toLowerCase().includes(k.toLowerCase()))
);

if (newPosts.length > 0) {
  await sendAlert(newPosts);
  const updatedSeen = [...seen, ...newPosts.map(p => p.urn)];
  await saveSeen(updatedSeen);
}