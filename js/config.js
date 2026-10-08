// js/config.js
const CONFIG = {
    supabase: {
        url: "https://vweivcuypbhdkxnfnkua.supabase.co",
        anonKey: "sb_publishable_TPAArVMOuYmziRLEshT5TA_lAwjhb-l"
    }
};

// Supabase JS Kliens inicializálása
if (typeof supabase !== 'undefined' && supabase.createClient) {
    window.supabaseClient = supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
} else {
    console.warn("A Supabase SDK nem található. Ellenőrizd a CDN beillesztését!");
}
