# 💊 DrugAssist – Osztályos Gyógyszerelési Rendszer

A **DrugAssist** egy modern, webalapú kórházi gyógyszerelési és osztályos betegellátási rendszer, amely leegyszerűsíti és biztonságossá teszi az osztályos orvosok és a központi gyógyszertár közötti igénylési folyamatokat.

---

## 🌟 Főbb Funkciók

- **🏥 Osztályos Betegkezelés:**
  - Aktív ápolt betegek és passzív (elbocsátott) betegek elkülönített nyilvántartása.
  - Beteg felvétele, adatainak szerkesztése, elbocsátása (hazamenetel) és újrafelvétele.
  - Kórterem és ágyszám szerinti rendezés és keresés.

- **📅 Intelligens Naptár és Terápia-kezelés:**
  - Betegspecifikus havi naptár nézet az igénylések áttekintésére.
  - Mai napra vonatkozó gyógyszerelési státusz valós idejű kijelzése.
  - Előző napi jóváhagyott terápia egykattintásos bemásolása az új igénylések gyorsításához.
  - Többnapos gyógyszerelés támogatása.

- **💊 Kettős Gyógyszerkereső:**
  - Integrált keresés a **Kórházi Alaplistában (Local Inventory)** és a **PuPha törzsadatbázisban**.
  - Egyedi adagolás beállítása napszakok szerint (reggel, délben, este, éjjel).
  - Saját/hozott gyógyszerek jelölése.

- **🔒 Biztonság és Státusz-követés:**
  - Egyedi vonalkódos azonosító generálása minden igényléshez (`DA-YYYYMMDD-XXXX`).
  - Automatized zárolás: a patikában feldolgozott (`reviewed`, `dispensed`, `completed`) rendelések nem módosíthatók visszamenőleg.

---

## 🛠️ Alkalmazott Technológiák

- **Frontend:** HTML5, CSS3 (Custom Responsive Styling), Vanilla JavaScript (ES6+)
- **Backend / Adatbázis:** [Supabase](https://supabase.com/) (PostgreSQL)
- **Autentikáció:** Supabase Auth & Egyedi szerepkör-kezelés

---

## 📐 Adatbázis Séma Overview

A rendszer az alábbi főbb PostgreSQL táblákra épül:

- `patients` – Betegadatok (név, TAJ, születési dátum, osztály, ágyszám, státusz).
- `prescriptions` – Gyógyszerigénylések fejlécei (beteg, rendelő orvos, vonalkód, státusz).
- `prescription_items` – Igénylések tételei (adagolások, hozott gyógyszer jelző, cserélt nevek).
- `local_inventory_master` – Kórházi alaplistás gyógyszerek.
- `pupha_master` – PuPha törzsadatbázis.

---

## 🚀 Telepítés és Beállítás

1. **Repozitórium klónozása:**
   ```bash
   git clone [https://github.com/FELHASZNALONEV/drugassist.git](https://github.com/FELHASZNALONEV/drugassist.git)
   cd drugassist
