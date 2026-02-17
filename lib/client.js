
import axios from 'axios';
import http from 'http';
import https from 'https';
import { USER_AGENT } from './utils.js';



const BASE_HEADERS = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en,ar;q=0.9',
    'Origin': 'https://www.seha.sa',
    'Referer': 'https://www.seha.sa/',
    'priority': 'u=1, i',
    'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin'
};

export const BASE_URL = 'https://www.seha.sa/api'; // Base URL

export function getClient(token, cookie) {
    const headers = { ...BASE_HEADERS };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (cookie) headers['Cookie'] = cookie;

    const instance = axios.create({
        baseURL: BASE_URL,
        headers: headers,
        timeout: 10000 // Default timeout
    });

    instance.interceptors.request.use(req => {
        // Weslah Fix: Strict Origin. 
        // We DO NOT strip cookies anymore because we are doing the full login flow on Weslah.
        // We DO NOT strip Authorization because legacy script uses it.
        if (req.url?.includes('weslah.seha.sa') || req.baseURL?.includes('weslah.seha.sa')) {
            if (req.headers && typeof req.headers.set === 'function') {
                req.headers.set('Origin', 'https://weslah.seha.sa');
                req.headers.set('Referer', 'https://weslah.seha.sa/');
            } else {
                req.headers['Origin'] = 'https://weslah.seha.sa';
                req.headers['Referer'] = 'https://weslah.seha.sa/';
            }
        }


        return req;
    });

    instance.interceptors.response.use(res => {
        // debugLog removed

        return res;
    }, err => {
        // Error logged silently (handled by callers)
        return Promise.reject(err);
    });

    return instance;
}

// For Login Session (Cookie Jar)
export function createSession() {
    let cookies = {};
    const instance = axios.create({
        baseURL: BASE_URL,
        headers: BASE_HEADERS,
        timeout: 15000
    });

    instance.interceptors.response.use(response => {
        const sc = response.headers['set-cookie'];
        if (sc) {

            for (const c of sc) {
                const [nameVal] = c.split(';');
                const [name, ...valParts] = nameVal.split('=');
                cookies[name.trim()] = valParts.join('=').trim();
            }
        }

        return response;
    }, err => {
        return Promise.reject(err);
    });

    instance.interceptors.request.use(config => {
        const str = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        if (str) config.headers['Cookie'] = str;



        return config;
    });

    return { http: instance, getCookies: () => cookies };
}

// Custom function to create sockets with TCP_NODELAY
const createConnection = (options, cb) => {
    const socket = require('net').createConnection(options, cb);
    socket.setNoDelay(true); // Disable Nagle's algorithm
    return socket;
};

// Ultra-fast client for burst acceptance (no timeout, keep-alive, minimal overhead)
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: Infinity, maxFreeSockets: 256, createConnection });
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: Infinity, maxFreeSockets: 256 }); // HTTPS uses its own createConnection logic usually, but let's trust Node default for TLS or use tls.connect with socket open


export function getAcceptClient(token, cookie) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://weslah.seha.sa',
        'Referer': 'https://weslah.seha.sa/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (cookie) headers['Cookie'] = cookie;

    return axios.create({
        headers,
        timeout: 0, // No timeout — never abort mid-burst
        httpAgent: keepAliveHttpAgent,
        httpsAgent: keepAliveHttpsAgent,
        // Disable automatic transforms for speed
        maxRedirects: 0,
        validateStatus: () => true // Handle all statuses manually
    });
}
