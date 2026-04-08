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

  console.log('🔍 Buscando posts con keyword: programador');
  console.log('🌐 Haciendo request a LinkedIn API...');

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
    console.log('📡 Enviando petición...');
    const response = await axios.get(url, { headers, params });
    
    console.log('📊 Status de respuesta:', response.status);
    console.log('📊 Hay datos?', !!response.data);
    
    const elements = response.data?.data?.elements || [];
    console.log(`📦 Posts encontrados en API: ${elements.length}`);
    
    if (elements.length === 0) {
      console.log('⚠️ No se encontraron posts. Verifica:');
      console.log('   1. Que las cookies sean válidas');
      console.log('   2. Que tengas sesión activa en LinkedIn');
      console.log('   3. Que la keyword "programador" tenga resultados');
      return;
    }
    
    // Mostrar los primeros 3 posts como ejemplo
    console.log('\n📝 Ejemplo de posts encontrados:');
    elements.slice(0, 3).forEach((el, i) => {
      const text = el.content?.text?.text || '';
      console.log(`\nPost ${i + 1}:`);
      console.log(`   Autor: ${el.author?.name || 'Desconocido'}`);
      console.log(`   Texto: ${text.substring(0, 150)}...`);
    });
    
    const posts = elements.map(el => ({
      id: el.urn,
      text: el.content?.text?.text || '',
      author: el.author?.name || 'Desconocido',
      url: `https://www.linkedin.com/feed/update/${el.urn}`
    }));
    
    const seen = await getSeen();
    console.log(`\n👀 Posts ya vistos en storage: ${seen.length}`);
    
    // Mostrar qué posts coinciden con keywords
    console.log('\n🔍 Filtrando por keywords...');
    const newPosts = posts.filter(p => {
      if (!p.id) return false;
      if (seen.includes(p.id)) return false;
      
      const textLower = p.text.toLowerCase();
      const matchedKeyword = KEYWORDS.find(k => textLower.includes(k.toLowerCase()));
      
      if (matchedKeyword) {
        console.log(`   ✅ Match encontrado: "${matchedKeyword}" en post de ${p.author}`);
      }
      
      return matchedKeyword;
    });
    
    console.log(`\n🧠 Posts nuevos con keywords: ${newPosts.length}`);
    
    if (newPosts.length > 0) {
      console.log('\n📧 Enviando alertas...');
      newPosts.forEach((post, idx) => {
        console.log(`\n📝 Post ${idx + 1} - Autor: ${post.author}`);
        console.log(`   Preview: ${post.text.substring(0, 200)}...`);
      });
      
      await sendAlert(newPosts);
      const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
      await saveSeen(updatedSeen);
      console.log('✅ Alertas enviadas y posts marcados como vistos');
    } else {
      console.log('\n😴 No hay posts nuevos que coincidan con las keywords');
      console.log('💡 Sugerencia: Revisa que las keywords en keywords.js sean correctas');
    }
    
    console.log('\n✨ Proceso completado');
    
  } catch (error) {
    console.error('❌ Error en la petición:');
    console.error('   Status:', error.response?.status);
    console.error('   Mensaje:', error.response?.data || error.message);
    
    if (error.response?.status === 401 || error.response?.status === 403) {
      console.log('\n⚠️ Las cookies expiraron. Debes generar nuevas cookies en tu Mac:');
      console.log('   1. cd ~/Desktop/enquadrebot');
      console.log('   2. HEADLESS=false node index.js');
      console.log('   3. Haz login manual');
      console.log('   4. Sube scraper/cookies.json a EC2 con git push');
    }
  }
};

// Ejecutar directamente
runBot();