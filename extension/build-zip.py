# Gera extension/jarvis-extension.zip (e a cópia ia-council-extension.zip para apps antigos) (arquivos na raiz, pronta para "Carregar sem compactação")
import os, zipfile
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "jarvis-extension.zip")
files = ["manifest.json", "background.js", "content.js", "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png"]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(os.path.join(here, f), f)
import shutil
shutil.copyfile(out, os.path.join(here, "ia-council-extension.zip"))  # nome antigo: o app 1.0.12 ou anterior ainda baixa este
print("ok:", out)
import json
v = json.load(open(os.path.join(here, "manifest.json")))["version"]
json.dump({"version": v}, open(os.path.join(here, "version.json"), "w"))
print("version.json:", v)
