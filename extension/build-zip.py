# Gera extension/ia-council-extension.zip (pasta "IA Council" pronta para "Carregar sem compactação")
import os, zipfile
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "ia-council-extension.zip")
files = ["manifest.json", "background.js", "content.js", "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png"]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(os.path.join(here, f), "IA Council/" + f)
print("ok:", out)
