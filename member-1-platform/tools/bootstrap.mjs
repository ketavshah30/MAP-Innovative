import {generateKeyPairSync, randomBytes} from 'node:crypto';
import {mkdirSync, existsSync, writeFileSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const local = path.join(root, '.local');
mkdirSync(local, {recursive:true});
const envPath = path.join(local, 'dev.env');
if (existsSync(envPath)) {
  console.log('Existing .local/dev.env preserved. Existing keys and data must stay together.');
  process.exit(0);
}
for (const file of ['pct-private.pem','pct-jwks.json','realm.json']) {
  if (existsSync(path.join(local,file))) throw new Error(`Partial bootstrap found: ${file}. Inspect before replacing keys.`);
}
const password = randomBytes(18).toString('hex');
const serviceKey = randomBytes(32).toString('hex');
const mediaKey = randomBytes(32).toString('hex');
const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength:2048});
writeFileSync(path.join(local,'pct-private.pem'), privateKey.export({type:'pkcs8',format:'pem'}), {mode:0o600});
writeFileSync(path.join(local,'pct-jwks.json'), JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'local-pct-1',alg:'RS256',use:'sig'}]},null,2));
const realm = {
  realm:'streaming',enabled:true,sslRequired:'none',registrationAllowed:false,
  roles:{realm:[{name:'catalog-admin'},{name:'support'}]},
  clients:[{clientId:'streaming',publicClient:true,directAccessGrantsEnabled:true,standardFlowEnabled:true,redirectUris:['http://localhost:8080/*'],webOrigins:['http://localhost:8080'],protocolMappers:[{name:'audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.client.audience':'streaming','access.token.claim':'true'}}]}],
  users:['alice','bob','admin'].map(username=>({username,enabled:true,emailVerified:true,firstName:username,lastName:'Local',email:`${username}@example.invalid`,credentials:[{type:'password',value:password,temporary:false}],realmRoles:username==='admin'?['catalog-admin','support']:[]}))
};
writeFileSync(path.join(local,'realm.json'),JSON.stringify(realm,null,2),{mode:0o600});
writeFileSync(envPath,`DEV_PASSWORD=${password}\nSERVICE_KEY=${serviceKey}\nMEDIA_KEY=${mediaKey}\nLOCAL_UID=${process.getuid?.()??1000}\nLOCAL_GID=${process.getgid?.()??1000}\n`,{mode:0o600});
console.log('Local development credentials are saved in .local/dev.env (DEV_PASSWORD).');
console.log('Created .local/dev.env and PCT keys. Do not commit or share .local/.');
