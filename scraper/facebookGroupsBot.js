import axios from 'axios';
import fs from 'fs/promises';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

// Configuración
const ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
const GROUP_IDS = process.env.FACEBOOK_GROUP_IDS ? process.env.FACEBOOK_GROUP_IDS.split(',') : [];
const KEYWORDS = [
    'programador', 'desarrollador', 'developer', 'ingeniero',
    'trabajo', 'empleo', 'contrato', 'freelance',
    'javascript', 'python', 'react', 'node', 'backend', 'frontend'
];

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Obtiene posts de un grupo de Facebook
 */
const getGroupFeed = async (groupId, since = null) => {
    const url = `https://graph.facebook.com/v20.0/${groupId}/feed`;
    
    const params = {
        access_token: ACCESS_TOKEN,
        fields: 'id,message,created_time,from,permalink_url,comments.summary(true),reactions.summary(true),attachments',
        limit: 50
    };
    
    if (since) {
        params.since = since;
    }
    
    try {
        const response = await axios.get(url, { params, timeout: 30000 });
        return response.data.data || [];
    } catch (error) {
        console.error(`❌ Error en grupo ${groupId}:`, error.response?.data?.error?.message || error.message);
        return [];
    }
};

/**
 * Obtiene información del grupo (nombre, privacidad)
 */
const getGroupInfo = async (groupId) => {
    const url = `https://graph.facebook.com/v20.0/${groupId}`;
    
    try {
        const response = await axios.get(url, {
            params: {
                access_token: ACCESS_TOKEN,
                fields: 'name,privacy,member_count'
            }
        });
        return response.data;
    } catch (error) {
        return { name: groupId, privacy: 'unknown' };
    }
};

/**
 * Filtra posts por keywords
 */
const filterPostsByKeywords = (posts, groupName) => {
    const matches = [];
    
    for (const post of posts) {
        const message = post.message || '';
        
        if (!message) continue;
        
        const matchedKeywords = KEYWORDS.filter(kw => 
            message.toLowerCase().includes(kw.toLowerCase())
        );
        
        if (matchedKeywords.length > 0) {
            matches.push({
                id: post.id,
                group_id: post.group_id || post.from?.id,
                group_name: groupName,
                message: message.substring(0, 1000),
                author: post.from?.name || 'Desconocido',
                created_time: post.created_time,
                url: post.permalink_url || `https://facebook.com/${post.id}`,
                comments: post.comments?.summary?.total_count || 0,
                reactions: post.reactions?.summary?.total_count || 0,
                matched_keywords: matchedKeywords
            });
        }
    }
    
    return matches;
};

/**
 * Obtiene todos los posts de todos los grupos
 */
const getAllGroupPosts = async () => {
    const allPosts = [];
    
    for (const groupId of GROUP_IDS) {
        console.log(`🔍 Buscando en grupo: ${groupId}...`);
        
        // Obtener info del grupo
        const groupInfo = await getGroupInfo(groupId);
        console.log(`   📌 Grupo: ${groupInfo.name} (${groupInfo.privacy || 'unknown'})`);
        
        // Obtener posts
        const posts = await getGroupFeed(groupId);
        console.log(`   📦 ${posts.length} posts obtenidos`);
        
        // Filtrar por keywords
        const matches = filterPostsByKeywords(posts, groupInfo.name);
        
        if (matches.length > 0) {
            console.log(`   ✅ ${matches.length} coincidencias encontradas`);
            allPosts.push(...matches);
        }
        
        // Delay entre grupos para evitar rate limiting
        await delay(2000);
    }
    
    return allPosts;
};

/**
 * Obtiene la lista de grupos del usuario
 */
const getUserGroups = async () => {
    const url = 'https://graph.facebook.com/v20.0/me/groups';
    
    try {
        const response = await axios.get(url, {
            params: {
                access_token: ACCESS_TOKEN,
                fields: 'id,name,privacy,member_count,administrator'
            }
        });
        return response.data.data || [];
    } catch (error) {
        console.error('❌ Error obteniendo grupos:', error.response?.data?.error?.message);
        return [];
    }
};

/**
 * Función principal del bot
 */
export const runFacebookBot = async () => {
    console.log('🚀 Iniciando Facebook Groups Bot...');
    console.log(`📋 Keywords: ${KEYWORDS.length} palabras clave`);
    console.log('');
    
    // Verificar token
    if (!ACCESS_TOKEN) {
        console.error('❌ FALTA FACEBOOK_ACCESS_TOKEN en .env');
        console.log('');
        console.log('📝 Para obtener un token:');
        console.log('   1. Ve a developers.facebook.com/apps');
        console.log('   2. Crea una app y ve a Graph API Explorer');
        console.log('   3. Genera un token con permiso groups_access_member_info');
        console.log('   4. Agrégalo a .env como FACEBOOK_ACCESS_TOKEN');
        return;
    }
    
    // Si no hay grupos configurados, obtener automáticamente
    let groupsToSearch = GROUP_IDS;
    
    if (groupsToSearch.length === 0 || (groupsToSearch.length === 1 && groupsToSearch[0] === '')) {
        console.log('🔍 No hay grupos configurados. Obteniendo tus grupos...');
        const userGroups = await getUserGroups();
        
        if (userGroups.length === 0) {
            console.log('❌ No se encontraron grupos o no tienes permisos');
            return;
        }
        
        console.log(`📋 Encontrados ${userGroups.length} grupos:`);
        userGroups.forEach(g => console.log(`   - ${g.name} (${g.id})`));
        
        groupsToSearch = userGroups.map(g => g.id);
    }
    
    console.log(`\n🔍 Buscando en ${groupsToSearch.length} grupos...`);
    console.log('');
    
    // Obtener todos los posts
    const allMatches = await getAllGroupPosts();
    
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 RESULTADOS TOTALES: ${allMatches.length} posts con keywords`);
    
    if (allMatches.length === 0) {
        console.log('😴 No se encontraron posts que coincidan con las keywords');
        return;
    }
    
    // Mostrar resultados
    console.log('\n📝 Posts encontrados:');
    allMatches.forEach((post, i) => {
        console.log(`\n${i + 1}. 📌 ${post.group_name}`);
        console.log(`   👤 Autor: ${post.author}`);
        console.log(`   🔑 Keywords: ${post.matched_keywords.join(', ')}`);
        console.log(`   📄 Preview: ${post.message.substring(0, 150)}...`);
        console.log(`   👍 ${post.reactions} reacciones | 💬 ${post.comments} comentarios`);
        console.log(`   🔗 ${post.url}`);
    });
    
    // Filtrar por posts ya vistos
    const seen = await getSeen('facebook');  // Usar almacenamiento separado
    const newPosts = allMatches.filter(p => !seen.includes(p.id));
    
    console.log(`\n👀 Posts nuevos: ${newPosts.length} (${allMatches.length - newPosts.length} ya vistos)`);
    
    // Enviar alertas
    if (newPosts.length > 0) {
        console.log('\n📧 Enviando alertas...');
        await sendAlert(newPosts, 'facebook');
        
        const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
        await saveSeen(updatedSeen, 'facebook');
        console.log('✅ Alertas enviadas');
    }
    
    console.log('\n✨ Proceso completado');
};

// Ejecutar directamente si se llama el archivo
if (import.meta.url === `file://${process.argv[1]}`) {
    runFacebookBot().catch(console.error);
}