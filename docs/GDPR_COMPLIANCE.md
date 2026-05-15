# VV Pulse — GDPR & Security Compliance Notes

> Document intern — VV Technologies | 2026-05-15

## Status Conformitate

| Categorie | Status | Actiune |
|-----------|--------|---------|
| Autentificare anonima | OK | Firebase Anonymous Auth |
| Locatie GPS | Necesita consimtamant explicit | Adauga dialog permisiune |
| Poze misiuni | Necesita politica clara | Specifica retentie 24h |
| VVEil blur fete | OK | Procesare locala pe device |
| Firebase config expusa | Securitate | API key vizibil - Rules trebuie securizate |
| Retentie date | Lipsa | Necesita TTL policy |

## Date Colectate

**SE colecteaza (Firebase Firestore):**
- UID anonim (generat de Firebase, nu legat de identitate reala)
- Alias ales de user
- Locatie GPS - TTL 90 secunde in vv_pulse collection
- Misiuni - descriere + coordonate + reward + timestamp
- Audit log VVhi

**NU se colecteaza:**
- Nume real, email, telefon, adresa, date de plata

## Permisiuni Browser

| Permisiune | Cand | Scop |
|------------|------|------|
| geolocation | La pornire | Harta + validare proximitate |
| camera | La acceptare misiune | VV Proof foto |
| microphone | Voice input Nexus | Cautare vocala |

## Firebase Security Rules - Recomandate

Verifica in Firebase Console > Firestore > Rules:

`javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /missions/{missionId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null && request.auth.uid == resource.data.createdBy;
      allow delete: if false;
    }
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId;
    }
    match /vv_pulse/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId;
    }
    match /inbox/{msgId} {
      allow read: if request.auth.uid == resource.data.to;
      allow create: if request.auth != null;
      allow delete: if request.auth.uid == resource.data.to;
    }
  }
}
`

## VVEil Note

VVEil proceseaza imaginile 100% local pe device (canvas API).
Nu se transmite nicio imagine la server inainte de blurare.
Algoritmul foloseste detectie prin culoarea pielii - nu ML.
Recomandat pe termen lung: TensorFlow.js face-detection pentru acuratete mai buna.

## Retentie Date Recomandata

| Colectie | Retentie |
|----------|---------|
| missions | 30-90 zile |
| vv_pulse | 90 secunde (TTL) |
| inbox | 30 zile |
| Firebase Storage (poze) | 24 ore |

*VV Technologies - Document Intern*