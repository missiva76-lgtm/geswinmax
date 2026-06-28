const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');

console.log('A testar Firebase com project:', serviceAccount.project_id);
console.log('Service account:', serviceAccount.client_email);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
admin.firestore().settings({ preferRest: true });

admin.firestore().collection('config').doc('winmax').get()
  .then(d => {
    console.log('✅ Firestore OK! Documento existe:', d.exists);
    if (d.exists) console.log('Dados:', JSON.stringify(d.data()));
    process.exit(0);
  })
  .catch(e => {
    console.error('❌ ERRO:', e.message);
    console.error('Código:', e.code);
    process.exit(1);
  });