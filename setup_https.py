import os, paramiko
NAS_HOST = os.environ.get('NAS_HOST', '192.168.1.80')
NAS_USER = os.environ.get('NAS_USER', 'it')
NAS_PASS = os.environ.get('NAS_PASS') or (_ for _ in ()).throw(
    SystemExit('Set NAS_PASS env var (NAS SSH password)'))
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(NAS_HOST, port=22, username=NAS_USER, password=NAS_PASS,
          look_for_keys=False, allow_agent=False)
cmd = r'''
which openssl
echo ---
cd /share/Public/lalien
mkdir -p certs
if [ ! -f certs/cert.pem ]; then
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout certs/key.pem -out certs/cert.pem \
    -days 3650 -subj "/CN=lalien-nas" 2>&1 | tail -3
fi
ls -la certs/
'''
i, o, e = c.exec_command(cmd)
print(o.read().decode(errors='replace'))
c.close()
