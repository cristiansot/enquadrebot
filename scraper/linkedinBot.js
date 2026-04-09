import axios from 'axios';
import fs from 'fs/promises';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Múltiples endpoints para probar (alguno funcionará)
const ENDPOINTS = [
  'https://www.linkedin.com/voyager/api/feed/updates',
  'https://www.linkedin.com/voyager/api/feed/updatesV2',
  'https://www.linkedin.com/voyager/api/feed/top',
  'https://www.linkedin.com/voyager/api/feed/updates?q=all',
  'https://www.linkedin.com/voyager/api/feed/updates?type=SHARED',
  'https://www.linkedin.com/voyager/api/feed/updates?count=50',
  'https://www.linkedin.com/voyager/api/content/feed',
  'https://www.linkedin.com/voyager/api/feed/home'
];

// Función para extraer texto de diferentes estructuras de LinkedIn
const extractPostData = (item) => {
  // Diferentes estructuras que LinkedIn puede usar
  const update = item.update || item;
  const content = update.content || update;
  const value = content.value || content;
  
  // Intentar diferentes caminos para obtener el texto
  const text = 
    content.text || 
    content.commentary || 
    value.text || 
    value.commentary ||
    content.description ||
    item.text ||
    '';
  
  // Intentar diferentes caminos para el autor
  const author = 
    update.actor?.name || 
    update.author?.name || 
    item.actor?.name || 
    item.author?.name ||
    update.actor?.fullName ||
    'Desconocido';
  
  // Intentar diferentes caminos para el ID
  const id = 
    update.urn || 
    item.urn || 
    update.id || 
    item.id ||
    `post_${Date.now()}_${Math.random()}`;
  
  return { text, author, id };
};

// Función para buscar posts con reintentos
const fetchPosts = async (headers, params, endpoint, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`   📡 Intentando ${i + 1}/${retries}: ${endpoint.substring(0, 60)}...`);
      const response = await axios.get(endpoint, { 
        headers, 
        params,
        timeout: 30000
      });
      
      if (response.status === 200) {
        return response;
      }
    } catch (error) {
      console.log(`   ⚠️ Intento ${i + 1} falló: ${error.response?.status || error.message}`);
      if (i < retries - 1) await delay(2000);
    }
  }
  return null;
};

export const runBot = async () => {
  console.log('🚀 Iniciando scraping en EC2...');
  console.log('📋 Keywords a buscar:', KEYWORDS.length, 'palabras clave');
  console.log('');

  // Leer cookies
  let cookies;
  try {
    const cookiesFile = await fs.readFile('./scraper/cookies.json', 'utf-8');
    cookies = JSON.parse(cookiesFile);
    console.log('✅ Cookies cargadas - Cantidad:', cookies.length);
  } catch (error) {
    console.log('❌ No se encontraron cookies');
    console.log('   Ejecuta en tu Mac: HEADLESS=false node index.js');
    return;
  }

  // Crear string de cookies
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  // Obtener CSRF token
  const csrfToken = cookies.find(c => c.name === 'JSESSIONID')?.value?.replace(/"/g, '') || '';

  const headers = {
    'Cookie': cookieString,
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'csrf-token': csrfToken,
    'Referer': 'https://www.linkedin.com/feed/',
    'Origin': 'https://www.linkedin.com'
  };

  const params = {
    count: 50,
    start: 0
  };

  console.log('🔍 Buscando posts en LinkedIn...');
  console.log('📡 Probando múltiples endpoints...');
  console.log('');

  let response = null;
  let workingEndpoint = null;

  // Probar cada endpoint hasta que uno funcione
  for (const endpoint of ENDPOINTS) {
    response = await fetchPosts(headers, params, endpoint, 2);
    if (response && response.status === 200) {
      workingEndpoint = endpoint;
      break;
    }
  }

  if (!response || response.status !== 200) {
    console.log('');
    console.log('❌ No se pudo conectar a LinkedIn desde EC2');
    console.log('');
    console.log('🔧 Posibles soluciones:');
    console.log('   1. Las cookies pueden haber expirado');
    console.log('   2. La IP de EC2 puede estar bloqueada por LinkedIn');
    console.log('   3. Necesitas generar nuevas cookies en tu Mac');
    console.log('');
    console.log('📝 Para renovar cookies en tu Mac:');
    console.log('   cd ~/Desktop/enquadrebot');
    console.log('   rm scraper/cookies.json');
    console.log('   HEADLESS=false node index.js');
    console.log('   git add scraper/cookies.json && git commit -m "update cookies"');
    console.log('   git push origin main');
    console.log('');
    console.log('📝 En EC2 luego:');
    console.log('   git pull origin main');
    return;
  }

  console.log('');
  console.log(`✅ Conectado exitosamente usando: ${workingEndpoint.substring(0, 60)}...`);
  console.log(`📊 Status: ${response.status}`);

  // Extraer elementos de diferentes estructuras posibles
  let elements = [];
  const data = response.data;
  
  if (data?.data?.elements) {
    elements = data.data.elements;
  } else if (data?.elements) {
    elements = data.elements;
  } else if (data?.data?.items) {
    elements = data.data.items;
  } else if (data?.items) {
    elements = data.items;
  } else if (Array.isArray(data)) {
    elements = data;
  } else {
    console.log('⚠️ Estructura de datos desconocida:', Object.keys(data));
    elements = [];
  }

  console.log(`📦 Posts encontrados en respuesta: ${elements.length}`);
  
  if (elements.length === 0) {
    console.log('');
    console.log('⚠️ No se encontraron posts. Posibles causas:');
    console.log('   - El feed está vacío');
    console.log('   - Las cookies no tienen permisos suficientes');
    console.log('   - La cuenta no tiene actividad reciente');
    return;
  }
  
  // Mostrar ejemplos de los primeros posts
  console.log('');
  console.log('📝 Ejemplo de los primeros posts:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  for (let i = 0; i < Math.min(3, elements.length); i++) {
    const { text, author } = extractPostData(elements[i]);
    console.log(`\n📌 Post ${i + 1}:`);
    console.log(`   👤 Autor: ${author}`);
    console.log(`   📄 Texto: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
  }
  
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // Extraer todos los posts
  const posts = [];
  const seenIds = new Set();
  
  for (const element of elements) {
    const { text, author, id } = extractPostData(element);
    
    if (text && text.length > 10 && !seenIds.has(id)) {
      seenIds.add(id);
      posts.push({
        id: id,
        text: text.substring(0, 1500),
        author: author,
        url: `https://www.linkedin.com/feed/update/${id}`,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  console.log(`📝 Posts válidos extraídos: ${posts.length}`);
  
  if (posts.length === 0) {
    console.log('⚠️ No se encontraron posts con texto válido');
    return;
  }
  
  // Filtrar posts ya vistos
  const seen = await getSeen();
  console.log(`👀 Posts ya vistos en el sistema: ${seen.length}`);
  
  // Filtrar por keywords
  console.log('');
  console.log('🔍 Filtrando posts por keywords...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const newPosts = [];
  
  for (const post of posts) {
    if (seen.includes(post.id)) continue;
    
    const textLower = post.text.toLowerCase();
    const matchedKeywords = KEYWORDS.filter(k => textLower.includes(k.toLowerCase()));
    
    if (matchedKeywords.length > 0) {
      console.log(`\n✅ MATCH ENCONTRADO!`);
      console.log(`   📝 Autor: ${post.author}`);
      console.log(`   🔑 Keywords: ${matchedKeywords.join(', ')}`);
      console.log(`   📄 Preview: ${post.text.substring(0, 150)}...`);
      newPosts.push(post);
    }
  }
  
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🧠 Posts nuevos con keywords: ${newPosts.length}`);
  
  if (newPosts.length > 0) {
    console.log('');
    console.log('📧 Enviando alertas por correo...');
    
    try {
      await sendAlert(newPosts);
      console.log('✅ Alertas enviadas exitosamente');
      
      // Guardar IDs de posts ya vistos
      const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
      await saveSeen(updatedSeen);
      console.log('💾 Posts marcados como vistos');
      
    } catch (error) {
      console.error('❌ Error al enviar alertas:', error.message);
    }
  } else {
    console.log('');
    console.log('😴 No hay posts nuevos que coincidan con las keywords');
    console.log('💡 Sugerencia: Revisa que las keywords en keywords.js sean correctas');
  }
  
  console.log('');
  console.log('✨ Proceso completado exitosamente');
  console.log(`📊 Resumen: ${posts.length} posts analizados, ${newPosts.length} nuevos matches`);
};

// Ejecutar
runBot().catch(error => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});