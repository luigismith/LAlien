import os, paramiko
NAS_HOST = os.environ.get('NAS_HOST', '192.168.1.80')
NAS_USER = os.environ.get('NAS_USER', 'it')
NAS_PASS = os.environ.get('NAS_PASS') or (_ for _ in ()).throw(
    SystemExit('Set NAS_PASS env var (NAS SSH password)'))
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(NAS_HOST, port=22, username=NAS_USER, password=NAS_PASS,
          look_for_keys=False, allow_agent=False)
cmd = r'''
for p in $(ps | awk '/httpd_lalien/ && !/awk/ {print $1}'); do kill $p 2>/dev/null; done
sleep 1
cd /share/Public/lalien
mkdir -p saves
setsid /mnt/ext/opt/Python/bin/python httpd_lalien.py /share/Public/lalien 9080 </dev/null >/share/Public/lalien.log 2>&1 &
sleep 2
ps | grep httpd_lalien | grep -v grep
echo ---log---
cat /share/Public/lalien.log
'''
i, o, e = c.exec_command(cmd)
print(o.read().decode(errors='replace'))
c.close()
