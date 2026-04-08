import axios from 'axios';
import fs from 'fs/promises';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

export const runBot = async () => {
  console.log('🚀 Iniciando scraping...');

  // Leer cookies
  let cookies;
  try {
    const cookiesFile = await fs.readFile('./scraper/cookies.json', 'utf-8');
    cookies = JSON.parse(cookiesFile);
    console.log('✅ Cookies cargadas');
  } catch (error) {
    console.log('❌ No se encontraron cookies');
    return;
  }

  // Crear string de cookies
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  // Obtener CSRF token
  const csrfToken = cookies.find(c => c.name === 'JSESSIONID')?.value?.replace(/"/g, '') || '';

  console.log('🔍 Buscando posts por keywords...');

  const headers = {
    'Cookie': cookieString,
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'csrf-token': csrfToken,
    'Referer': 'https://www.linkedin.com/'
  };

  const url = 'https://www.linkedin.com/voyager/api/content/search';
  const params = {
    q: 'all',
    keywords: 'programador',
    count: 50
  };

  try {
    const response = await axios.get(url, { headers, params });
    const elements = response.data?.data?.elements || [];
    console.log(`📦 Posts encontrados: ${elements.length}`);
    
    const posts = elements.map(el => ({
      id: el.urn,
      text: el.content?.text?.text || '',
      author: el.author?.name || 'Desconocido',
      url: `https://www.linkedin.com/feed/update/${el.urn}`
    }));
    
    const seen = await getSeen();
    console.log(`👀 Posts ya vistos: ${seen.length}`);
    
    const newPosts = posts.filter(p => 
      p.id && 
      !seen.includes(p.id) && 
      KEYWORDS.some(k => p.text.toLowerCase().includes(k.toLowerCase()))
    );
    
    console.log(`🧠 Posts nuevos con keywords: ${newPosts.length}`);
    
    if (newPosts.length > 0) {
      console.log(`📧 Enviando ${newPosts.length} alertas...`);
      await sendAlert(newPosts);
      const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
      await saveSeen(updatedSeen);
      console.log('✅ Alertas enviadas');
    } else {
      console.log('😴 No hay posts nuevos');
    }
    
    console.log('✨ Proceso completado');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.status, error.response?.data || error.message);
    
    if (error.response?.status === 401 || error.response?.status === 403) {
      console.log('\n⚠️ Las cookies expiraron. Ejecuta: HEADLESS=false node index.js');
    }
  }
};

// Ejecutar directamente si se llama el archivo
if (import.meta.url === `file://${process.argv[1]}`) {
  runBot();
}
