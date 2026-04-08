import axios from 'axios';
import fs from 'fs/promises';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

export const runBot = async () => {
  console.log('🚀 Iniciando scraping...');
  console.log('📋 Keywords a buscar:', KEYWORDS);

  // Leer cookies
  let cookies;
  try {
    const cookiesFile = await fs.readFile('./scraper/cookies.json', 'utf-8');
    cookies = JSON.parse(cookiesFile);
    console.log('✅ Cookies cargadas - Cantidad:', cookies.length);
  } catch (error) {
    console.log('❌ No se encontraron cookies');
    return;
  }

  // Crear string de cookies
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  // Obtener CSRF token
  const csrfToken = cookies.find(c => c.name === 'JSESSIONID')?.value?.replace(/"/g, '') || '';

  console.log('🔍 Obteniendo posts del feed...');

  const headers = {
    'Cookie': cookieString,
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'csrf-token': csrfToken,
    'Referer': 'https://www.linkedin.com/feed/'
  };

  // Endpoint del feed (más estable que search)
  const url = 'https://www.linkedin.com/voyager/api/feed/updates';

  try {
    console.log('📡 Enviando petición al feed...');
    const response = await axios.get(url, { 
      headers, 
      params: {
        count: 50,
        start: 0
      }
    });
    
    console.log('📊 Status:', response.status);
    
    const elements = response.data?.data?.elements || response.data?.elements || [];
    console.log(`📦 Posts encontrados: ${elements.length}`);
    
    if (elements.length === 0) {
      console.log('⚠️ No se encontraron posts. Las cookies pueden haber expirado.');
      return;
    }
    
    // Mostrar ejemplos
    console.log('\n📝 Ejemplo de posts:');
    elements.slice(0, 3).forEach((el, i) => {
      const update = el.update || el;
      const content = update.content || update;
      const text = content.text || content.commentary || '';
      const author = update.actor?.name || 'Desconocido';
      console.log(`\nPost ${i + 1}:`);
      console.log(`   Autor: ${author}`);
      console.log(`   Texto: ${text.substring(0, 150)}...`);
    });
    
    // Extraer posts
    const posts = elements.map(el => {
      const update = el.update || el;
      const content = update.content || update;
      const text = content.text || content.commentary || '';
      const author = update.actor?.name || 'Desconocido';
      const id = update.urn || el.urn || `post_${Date.now()}_${Math.random()}`;
      
      return {
        id: id,
        text: text.substring(0, 1000),
        author: author,
        url: `https://www.linkedin.com/feed/update/${id}`
      };
    }).filter(p => p.text.length > 0);
    
    console.log(`\n📝 Posts con texto: ${posts.length}`);
    
    const seen = await getSeen();
    console.log(`👀 Posts ya vistos: ${seen.length}`);
    
    // Filtrar por keywords
    console.log('\n🔍 Filtrando por keywords...');
    const newPosts = posts.filter(p => {
      if (seen.includes(p.id)) return false;
      const textLower = p.text.toLowerCase();
      const matched = KEYWORDS.some(k => textLower.includes(k.toLowerCase()));
      if (matched) console.log(`   ✅ Match: "${p.author}"`);
      return matched;
    });
    
    console.log(`\n🧠 Posts nuevos con keywords: ${newPosts.length}`);
    
    if (newPosts.length > 0) {
      console.log('\n📧 Enviando alertas...');
      await sendAlert(newPosts);
      const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
      await saveSeen(updatedSeen);
      console.log('✅ Alertas enviadas');
    } else {
      console.log('\n😴 No hay posts nuevos que coincidan con las keywords');
    }
    
    console.log('\n✨ Proceso completado');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.status, error.response?.statusText);
    console.error('   Mensaje:', error.message);
    
    if (error.response?.status === 401 || error.response?.status === 403) {
      console.log('\n⚠️ Las cookies expiraron. Genera nuevas en tu Mac:');
      console.log('   1. cd ~/Desktop/enquadrebot');
      console.log('   2. HEADLESS=false node index.js');
      console.log('   3. git add scraper/cookies.json && git commit -m "update cookies" && git push');
      console.log('   4. En EC2: git pull origin main');
    }
  }
};

runBot();