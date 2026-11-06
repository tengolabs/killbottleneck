#!/usr/bin/env python3
# Podmnožiny písem pro PDF (frontend/public/fonts/pdf/) jsou odvozené z Liberation Sans /
# Liberation Serif (Red Hat, SIL OFL 1.1) — osekané na latinku (~620 glyfů z 2 500+).
# OFL §3: upravená verze NESMÍ nést vyhrazené jméno „Liberation“ (ani ve jménu rodiny,
# ani v názvu souboru). Proto se podmnožiny jmenují „KB Sans“ / „KB Serif“ a tento skript
# přepíše tabulku jmen. Licenční audit 14. 10. a 4. 11. 2026, nález L2.
#
# Jednorázově (po případné nové podmnožině z upstreamu):
#   python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools
#   /tmp/ft/bin/python product/scripts/prejmenuj-fonty-pdf.py product/frontend/public/fonts/pdf
#
# Vstup: Liberation{Sans,Serif}-{Regular,Bold,Italic,BoldItalic}.ttf, výstup: KB{Sans,Serif}-*.ttf
# (vstupy smaže). Copyright a odkaz na OFL v tabulce zůstávají; doplní se poznámka o původu.
import sys, os, glob
from fontTools.ttLib import TTFont

slozka = sys.argv[1]
for cesta in sorted(glob.glob(os.path.join(slozka, "Liberation*.ttf"))):
    nazev = os.path.basename(cesta)
    rodina_stara = "Liberation Serif" if "Serif" in nazev else "Liberation Sans"
    rodina_nova = "KB Serif" if "Serif" in nazev else "KB Sans"
    ps_stara = rodina_stara.replace(" ", "")
    ps_nova = rodina_nova.replace(" ", "")
    f = TTFont(cesta)
    for rec in f["name"].names:
        txt = rec.toUnicode()
        if rec.nameID in (1, 3, 4, 16, 18, 21):
            rec.string = txt.replace(rodina_stara, rodina_nova).replace("Ascender - ", "")
        elif rec.nameID in (6, 20):
            rec.string = txt.replace(ps_stara, ps_nova)
        elif rec.nameID == 7:  # trademark Red Hatu se netýká odvozeniny
            rec.string = ""
        elif rec.nameID == 10:
            rec.string = (f"{rodina_nova} is a Latin subset of {rodina_stara} (Red Hat, Inc.), "
                          "renamed as required by the SIL Open Font License 1.1 (Reserved Font Name). "
                          "Used by killBottleneck for PDF output.")
    f["name"].removeNames(nameID=7)
    vystup = os.path.join(slozka, nazev.replace(ps_stara, ps_nova))
    f.save(vystup)
    os.remove(cesta)
    print(f"{nazev} → {os.path.basename(vystup)} ({len(f.getGlyphOrder())} glyfů)")
