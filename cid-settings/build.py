"""Generate an ID8 native page and pack its SDK-free source package."""
import base64
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import uuid
import zlib

from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageOps

HERE = Path(__file__).resolve().parent
UPSTREAM = Path(os.environ.get('MGU_STORE', HERE.parents[1] / 'mgu-store')).resolve()
TEMPLATE = UPSTREAM / 'apps/robertn_store/robertn_store@0.9.27'
APP_ID = 'arcade_settings'
VERSION = '0.1.3'
TREE = HERE / f'{APP_ID}@{VERSION}'
SOURCE = HERE / 'src'
KIT = Path(os.environ.get('IDRIVE7_APPS', HERE.parents[1] / 'idrive7-apps')).resolve() / 'kit'
DASHBOARD = Path(os.environ.get('DASHBOARD_DIR', HERE.parent)).resolve()
ROWS = 16


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def uid(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, APP_ID + '/' + name))


def vendor_kit():
    # record.js already includes the settings renderer's picture protocol.
    source = (KIT / 'runtime/canvas.js').read_text()
    # The source linker resolves local modules by explicit .js basename.
    for required, substitute in [('record', 'record'), ('canvas', 'canvas'),
                                 ('fonts', 'font'), ('i18n', 'font')]:
        source = source.replace(f"require('./{required}')", f"require('./{substitute}.js')")
    (SOURCE / 'canvas.js').write_text(source)


def bake_font():
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location('bake_fonts', KIT / 'tools/bake_fonts.py')
    baker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baker)
    system_fonts = Path('/System/Library/AssetsV2')
    pingfang = next(system_fonts.glob('com_apple_MobileAsset_Font*/*/AssetData/PingFang.ttc'), None)
    font = Path(os.environ.get('SETTINGS_CJK_FONT') or pingfang or '/System/Library/Fonts/PingFang.ttc')
    index = 7 if font.name == 'PingFang.ttc' else 0
    baker.load = lambda fname, var, size: baker.ImageFont.truetype(str(font), size, index=index)
    source = ''.join(p.read_text() for p in SOURCE.glob('*.js') if p.name != 'font-atlas.js')
    chars = set(map(chr, range(32, 127))) | set(re.findall(r'[^\x00-\x7f\s]', source))
    chars.update('°·–—…×±↑↓→←≥≤')
    cmap = TTFont(font, fontNumber=index).getBestCmap()
    missing = sorted(ch for ch in chars if ord(ch) not in cmap)
    assert not missing, f'{font.name} missing {missing}'
    face = baker.bake(font.name, None, 42, ''.join(sorted(chars)))
    assert face['atlasH'] <= 1024
    assert set(face['glyphs']) == set(map(ord, chars))
    assert all(g[2] and g[3] for code, g in face['glyphs'].items() if code != 32)
    atlas = {'family': 'arcade-settings-cjk', 'source': font.name,
             'cacheKey': hashlib.sha256(face['alpha'].encode()).hexdigest()[:16], 'sizes': [face]}
    payload = json.dumps(atlas, separators=(',', ':')) + '\n'
    (SOURCE / 'font-cjk.json').write_text(payload)
    (SOURCE / 'font-atlas.js').write_text("'use strict';\nmodule.exports = " + payload.rstrip() + ';\n')
    print(f'{font.name}: {len(chars)} glyphs, {len(missing)} missing, {face["atlasW"]}×{face["atlasH"]}, {len(payload)} bytes')


def load_logo():
    assets = DASHBOARD / 'assets'
    info = json.loads((assets / 'logo.json').read_text())
    return Image.frombytes('RGBA', (info['width'], info['height']), (assets / 'logo.rgba').read_bytes())


def app_icon(output):
    logo = ImageOps.contain(load_logo(), (140, 140), Image.Resampling.LANCZOS)
    icon = Image.new('RGBA', (140, 140), '#000000')
    icon.alpha_composite(logo, ((140 - logo.width) // 2, (140 - logo.height) // 2))
    icon.save(output)


def bake_wordmark():
    crop = load_logo().crop((35, 252, 460, 430))
    r, g, b, _ = crop.split()
    alpha = ImageChops.lighter(ImageChops.lighter(r, g), b)
    # RGB already contains coverage against black. Filter each premultiplied channel once.
    r, g, b, alpha = [c.resize((212, 89), Image.Resampling.LANCZOS) for c in (r, g, b, alpha)]
    channels = [ImageChops.darker(c, alpha) for c in (r, g, b)]
    image = Image.merge('RGBA', (*channels, alpha))
    data = base64.b64encode(zlib.compress(image.tobytes(), 9)).decode('ascii')
    (SOURCE / 'logo-asset.js').write_text(
        "'use strict';\nconst zlib = require('zlib');\n"
        f"module.exports = {{ id: 87, w: 212, h: 89, data: zlib.inflateSync(Buffer.from('{data}', 'base64')) }};\n")


pkg = json.loads((TEMPLATE / 'package.json').read_text())
pkg.update(name=APP_ID, version=VERSION, description='87 Arcade 仪表布局、数据与颜色阈值设置',
           mguHmi=['ID8'], license='GPL-3.0-or-later')
pkg['oapAppSettings'].update(loggingId='ARCS', cpuLimit=10, memoryThresholdKB=65536,
                           maxDiskUsage=8388608)
pkg['files'] = ['config', 'rhmiData', 'package.json', 'permissions.json', 'javascript', 'manifest.json', 'LICENSE']
write_json(TREE / 'package.json', pkg)
write_json(TREE / 'config/base.json', {})
manifest = json.loads((TEMPLATE / 'manifest.json').read_text())
for name in list(manifest['proxies']):
    if 'FrontCCU' in name or 'HMIContext' in name:
        del manifest['proxies'][name]
write_json(TREE / 'manifest.json', manifest)
shutil.copyfile(TEMPLATE / 'permissions.json', TREE / 'permissions.json')
shutil.copyfile(UPSTREAM / 'LICENSE', TREE / 'LICENSE')

description = json.loads((TEMPLATE / 'rhmiData/application.json').read_text())
a = description['application']
a.update(uuid=uid('app'), name=APP_ID, version=VERSION,
         stringBundleUuid=uid('strings'), resourceBundleUuid=uid('resources'))
a['uiDescriptions'] = [x for x in a['uiDescriptions'] if x['hmi'] == ['ID8']]
a['variantGroups'][0]['hmi'] = ['ID8']
a['entryPoints'] = [dict(a['entryPoints'][0], name=APP_ID, uuid=uid('entry'),
                         textId='SID_ARCADE_SETTINGS', icon='arcade.png',
                         uri='state:/base/startmenu/menudrawer', clientFocusId=1, private=False)]
for field in ('insertionStateId', 'insertionFocusId', 'insertionMode'):
    del a['entryPoints'][0][field]
write_json(TREE / 'rhmiData/application.json', description)

original = json.loads((TEMPLATE / 'rhmiData/uiDescriptions/ID8/uiDescription.json').read_text())
title = copy.deepcopy(original['containers']['1']['components']['10'])
title['name'] = 'SettingsTitle'
title['rows'][0]['Text']['value'] = 'SID_ARCADE_SETTINGS'
components = {'10': title}
notice = copy.deepcopy(original['containers']['1']['components']['20'])
notice['name'] = 'SettingsNotice'
notice['properties']['Visible']['value'] = 0
notice['rows'][0]['Text'] = {'value': '', 'type': 'Text'}
components['19'] = notice
for i in range(ROWS):
    row = copy.deepcopy(original['containers']['1']['components']['21'])
    row['name'] = 'row' + str(i)
    row['rows'][0]['PrimaryText'] = {'value': '', 'type': 'Text'}
    components[str(20 + i)] = row
write_json(TREE / 'rhmiData/uiDescriptions/ID8/uiDescription.json', {
    'schemaVersion': '1.3.0', 'containers': {
        '1': {'type': 'state', 'name': 'ST_Settings', 'components': components}}})
xml = '''<?xml version="1.0" encoding="UTF-8"?>
<application><container id="1" type="state" widget="LT_State_Wide_List">
<layoutGroup id="102" name="Titlebar"><component id="10" type="title"><property id="2" value="1"/></component></layoutGroup>
<layoutGroup id="103" name="List"><property id="3" value="1"/>
<component id="19" type="label" widget="LT_ScrollLabel"><property id="2" value="1"/><property id="3" value="0"/></component>
'''
for i in range(ROWS):
    xml += f'<component id="{20+i}" type="button" widget="LT_Button_MediaEntry_1Row"><property id="2" value="1"/><property id="3" value="3"/></component>\n'
xml += '</layoutGroup></container></application>\n'
(TREE / 'rhmiData/uiDescriptions/ID8/application.xml').write_text(xml)
for lang in (TEMPLATE / 'rhmiData/variantGroups/Common/texts').glob('*.json'):
    write_json(TREE / 'rhmiData/variantGroups/Common/texts' / lang.name,
               {'SID_TEMP_EMPTY': '', 'SID_ARCADE_SETTINGS': '87 Arcade 设置'})

image = TREE / 'rhmiData/variantGroups/Common/images/arcade.png'
image.parent.mkdir(parents=True, exist_ok=True)
app_icon(image)
bake_wordmark()
shutil.copyfile(DASHBOARD / 'settings.js', SOURCE / 'settings.js')
vendor_kit()
bake_font()
modules = ['src/main.js'] + sorted('src/' + p.name for p in SOURCE.glob('*.js') if p.name != 'main.js')
subprocess.run(['node', '--expose-internals', '-e', """
const fs = require('fs');
const acorn = require(process.env.ACORN_MODULE || 'internal/deps/acorn/acorn/dist/acorn');
for (const file of process.argv.slice(1)) acorn.parse(fs.readFileSync(file, 'utf8'), {ecmaVersion: 2017});
console.log('Acorn ES2017:', process.argv.length - 1, 'modules');
""", *modules], cwd=HERE, check=True)
write_json(HERE / 'mgu-app.json', {'schema': 1, 'id': APP_ID, 'version': VERSION,
    'mguHmi': ['ID8'], 'tree': TREE.name, 'modules': modules,
    'sdk': ['oap-sdk/src/core/OnlineApp.js', 'oap-sdk/src/logging/logging']})

assert len(components) == ROWS + 2
assert a['entryPoints'][0]['uuid'] != json.loads((TEMPLATE / 'rhmiData/application.json').read_text())['application']['entryPoints'][0]['uuid']
import xml.etree.ElementTree as ET
assert {n.attrib['id'] for n in ET.fromstring(xml).iter('component')} == set(components)
subprocess.run(['node', '-e', 'const p=require(process.argv[1]);p.packSource(process.argv[2],process.argv[3]);',
    str(UPSTREAM / 'tools/oap_link.js'), str(HERE), str(HERE / f'{APP_ID}@{VERSION}.src.tgz')], check=True)
archive = HERE / f'{APP_ID}@{VERSION}.src.tgz'
with tarfile.open(archive, 'r:gz') as package:
    names = set(package.getnames())
    assert set(modules) | {'mgu-app.json', str(image.relative_to(HERE))} <= names
    assert not any('oap-sdk' in name for name in names)
print(f'Built {archive} ({archive.stat().st_size} bytes)')
