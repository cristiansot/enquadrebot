import axios from 'axios';
import fs from 'fs/promises';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Leer cookies
const cookiesFile = await fs.readFile('./scraper/cookies.json', 'utf-8');
const cookies = JSON.parse(cookiesFile);

// Crear string de cookies
const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

// Obtener CSRF token
const csrfToken = cookies.find(c => c.name === 'JSESSIONID')?.value?.replace(/"/g, '') || '';

console.log('🔍 Buscando posts por keywords...');

// Configurar headers
const headers = {
  'Cookie': cookieString,
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'csrf-token': csrfToken,
  'Referer': 'https://www.linkedin.com/',
  'Origin': 'https://www.linkedin.com'
};

// Buscar posts usando la API de Voyager
const url = 'https://www.linkedin.com/voyager/api/content/search';

const params = {
  q: 'all',
  keywords: 'programador',
  count: 50,
  filters: '["SORT_BY_DATE_POSTED"]'
};

try {
  const response = await axios.get(url, { headers, params });
  const elements = response.data?.data?.elements || [];
  
  console.log(`📦 Posts encontrados: ${elements.length}`);
  
  if (elements.length === 0) {
    console.log('⚠️ No se encontraron posts. Es posible que necesites nuevas cookies.');
    process.exit(0);
  }
  
  // Extraer información relevante
  const posts = elements.map(el => ({
    id: el.urn,
    text: el.content?.text?.text || el.content?.description || '',
    author: el.author?.name || el.actor?.name || 'Desconocido',
    url: `https://www.linkedin.com/feed/update/${el.urn}`,
    timestamp: el.createdAt
  }));
  
  console.log(`📝 Posts extraídos: ${posts.length}`);
  
  // Filtrar por keywords
  const seen = await getSeen();
  console.log(`👀 Posts ya vistos: ${seen.length}`);
  
  const newPosts = posts.filter(p => 
    p.id && 
    !seen.includes(p.id) && 
    KEYWORDS.some(k => p.text.toLowerCase().includes(k.toLowerCase()))
  );
  
  console.log(`🧠 Posts nuevos con keywords: ${newPosts.length}`);
  
  if (newPosts.length > 0) {
    console.log(`\n📧 Enviando ${newPosts.length} alertas...`);
    newPosts.forEach((post, idx) => {
      console.log(`\n📝 Post ${idx + 1}:`);
      console.log(`   Autor: ${post.author}`);
      console.log(`   Preview: ${post.text.substring(0, 100)}...`);
    });
    
    await sendAlert(newPosts);
    const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
    await saveSeen(updatedSeen);
    console.log('✅ Alertas enviadas');
  } else {
    console.log('😴 No hay posts nuevos con las keywords');
  }
  
} catch (error) {
  console.error('❌ Error:', error.response?.status, error.response?.data || error.message);
  
  if (error.response?.status === 401 || error.response?.status === 403) {
    console.log('\n⚠️ Las cookies expiraron. Debes generar nuevas cookies en tu Mac:');
    console.log('1. En tu Mac: cd ~/Desktop/enquadrebot');
    console.log('2. Ejecutar: HEADLESS=false node index.js');
    console.log('3. Haz login manual');
    console.log('4. Sube scraper/cookies.json a EC2');
  }
}

