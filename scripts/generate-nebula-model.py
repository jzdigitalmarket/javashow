"""Generate the compact glTF interceptor used by Nebula 3 (no external Python packages)."""
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'models' / 'interceptor.glb'

MATERIALS = [
    ('ceramic armor', [0.17, 0.28, 0.40, 1], .72, .36, None),
    ('wing alloy', [0.32, 0.49, 0.60, 1], .86, .30, None),
    ('canopy', [0.018, 0.12, 0.19, 1], .38, .12, None),
    ('cyan navigation', [0.03, 0.62, 0.82, 1], .12, .25, [0.02, 0.48, 0.75]),
    ('engine plasma', [1, .33, .08, 1], .15, .3, [.85, .18, .02]),
    ('underside', [.07, .11, .17, 1], .54, .58, None),
]

surfaces = [[] for _ in MATERIALS]

def triangle(material, a, b, c):
    ab = [b[i] - a[i] for i in range(3)]
    ac = [c[i] - a[i] for i in range(3)]
    n = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]]
    length = math.sqrt(sum(x*x for x in n)) or 1
    n = [x/length for x in n]
    surfaces[material].extend([(a, n), (b, n), (c, n)])

def quad(material, a, b, c, d):
    triangle(material, a, b, c)
    triangle(material, a, c, d)

def prism(material, top, bottom):
    for i in range(len(top)):
        j = (i + 1) % len(top)
        quad(material, top[i], top[j], bottom[j], bottom[i])
    for i in range(1, len(top)-1):
        triangle(material, top[0], top[i], top[i+1])
        triangle(material, bottom[0], bottom[i+1], bottom[i])

# Faceted central hull, with a sharp nose and a wide aft section.
rings = [(-3.2, .03, .05), (-2.3, .46, .22), (-.8, .83, .39),
         (.7, .91, .43), (1.95, .61, .31), (2.35, .50, .28)]
for (z0, w0, h0), (z1, w1, h1) in zip(rings, rings[1:]):
    quad(0, (-w0, h0, z0), (w0, h0, z0), (w1, h1, z1), (-w1, h1, z1))
    quad(5, (w0, -h0, z0), (-w0, -h0, z0), (-w1, -h1, z1), (w1, -h1, z1))
    for side in (-1, 1):
        quad(1, (side*w0, h0, z0), (side*w0, -h0, z0),
             (side*w1, -h1, z1), (side*w1, h1, z1))

# Sweeped wings, raised stabilizers, a recessed cockpit and two engine nozzles.
for side in (-1, 1):
    def wing(x, y, z): return (side*x, y, z)
    wing_top = [wing(.55, .03, -1.20), wing(1.65, -.04, -.75),
                wing(3.18, -.12, .02), wing(3.45, -.15, .86),
                wing(1.94, .06, 1.55), wing(.65, .08, 1.50)]
    prism(1, wing_top, [(x, y-.16, z) for x,y,z in wing_top])
    quad(3, wing(2.53, -.08, .21), wing(3.22, -.12, .05),
         wing(3.34, -.13, .79), wing(2.76, -.05, .99))
    fin_top = [wing(1.72, .10, .85), wing(2.03, .79, 1.28),
               wing(2.13, .74, 1.77), wing(1.72, .09, 1.68)]
    prism(0, fin_top, [(x-side*.10, y, z) for x,y,z in fin_top])
    # Ten-sided concentric engine nozzle viewed from behind.
    cx, cy = side*.47, -.05
    for i in range(10):
        a, b = i*2*math.pi/10, (i+1)*2*math.pi/10
        def radial(r, angle, z): return (cx+r*math.cos(angle),cy+r*math.sin(angle),z)
        quad(5, radial(.35,a,2.14), radial(.35,b,2.14),
             radial(.34,b,2.61), radial(.34,a,2.61))
        quad(4, radial(.25,a,2.62), radial(.25,b,2.62),
             radial(.01,b,2.64), radial(.01,a,2.64))

canopy = [(-.33,.44,-1.61), (.33,.44,-1.61), (.54,.76,-.65),
          (.48,.72,.28), (-.48,.72,.28), (-.54,.76,-.65)]
prism(2, canopy, [(x,.30,z) for x,_,z in canopy])
quad(3, (-.09,.79,-.77), (.09,.79,-.77), (.09,.75,.30), (-.09,.75,.30))

# glTF 2.0 binary: one interleaved POSITION/NORMAL accessor pair per material.
binary = bytearray()
views, accessors, primitives = [], [], []
for material, vertices in enumerate(surfaces):
    if not vertices: continue
    offset = len(binary)
    for position, normal in vertices:
        binary.extend(struct.pack('<6f', *position, *normal))
    while len(binary)%4: binary.append(0)
    view_index = len(views)
    views.append({'buffer':0,'byteOffset':offset,'byteLength':len(vertices)*24,
                  'byteStride':24,'target':34962})
    positions = [p for p,_ in vertices]
    accessors.extend([
        {'bufferView':view_index,'byteOffset':0,'componentType':5126,'count':len(vertices),
         'type':'VEC3','min':[min(p[i] for p in positions) for i in range(3)],
         'max':[max(p[i] for p in positions) for i in range(3)]},
        {'bufferView':view_index,'byteOffset':12,'componentType':5126,'count':len(vertices),'type':'VEC3'}
    ])
    primitives.append({'attributes':{'POSITION':len(accessors)-2,'NORMAL':len(accessors)-1},
                       'material':material,'mode':4})

materials = []
for name, color, metallic, roughness, emissive in MATERIALS:
    item = {'name':name,'pbrMetallicRoughness':{'baseColorFactor':color,
            'metallicFactor':metallic,'roughnessFactor':roughness},'doubleSided':True}
    if emissive: item['emissiveFactor'] = emissive
    materials.append(item)
gltf = {'asset':{'version':'2.0','generator':'Nebula 3 procedural interceptor'},
        'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors,
        'materials':materials,'meshes':[{'name':'Interceptor Mk II','primitives':primitives}],
        'nodes':[{'mesh':0,'name':'Interceptor Mk II'}],
        'scenes':[{'nodes':[0]}],'scene':0}
json_chunk = json.dumps(gltf,separators=(',',':')).encode()
json_chunk += b' ' * (-len(json_chunk)%4)
OUTPUT.parent.mkdir(exist_ok=True)
with OUTPUT.open('wb') as file:
    file.write(struct.pack('<4sII',b'glTF',2,12+8+len(json_chunk)+8+len(binary)))
    file.write(struct.pack('<I4s',len(json_chunk),b'JSON'))
    file.write(json_chunk)
    file.write(struct.pack('<I4s',len(binary),b'BIN\0'))
    file.write(binary)
print(f'Created {OUTPUT} ({OUTPUT.stat().st_size} bytes)')

# A separate silhouette for the boss: broad swept wings and paired mandibles.
boss_materials = [
    ('boss armor', [.24, .07, .18, 1], .86, .32, None),
    ('boss wing', [.33, .13, .27, 1], .8, .3, None),
    ('boss canopy', [.055, .016, .13, 1], .4, .18, None),
    ('boss weapon trim', [.72, .08, .55, 1], .25, .3, [.47, .02, .32]),
    ('boss thruster', [.27, .08, .82, 1], .1, .25, [.18, .04, .62]),
    ('boss underside', [.09, .04, .11, 1], .5, .55, None),
]
surfaces = [[] for _ in boss_materials]
for side in (-1, 1):
    def v(x,y,z): return (side*x,y,z)
    wing = [v(.65,.12,-2.4),v(2.4,.15,-2.6),v(5.6,.12,-.7),
            v(5.9,.10,1.65),v(3.7,.14,2.8),v(1,.28,2.2)]
    prism(1, wing, [(x,y-.48,z) for x,y,z in wing])
    prism(0, [v(1.15,.25,-1.8),v(2.05,.28,-5.1),v(2.38,.15,-5.3),v(2.1,.20,-1.6)],
          [v(1.15,-.35,-1.8),v(2.05,-.16,-5.1),v(2.38,-.18,-5.3),v(2.1,-.4,-1.6)])
    quad(3,v(3.7,.17,-1.0),v(5.24,.14,-.6),v(5.45,.14,.35),v(4.1,.17,.20))
    for x in (1.35,2.2):
        for i in range(10):
            a,b=i*2*math.pi/10,(i+1)*2*math.pi/10
            quad(4,v(x+.42*math.cos(a),.42*math.sin(a),2.8),
                 v(x+.42*math.cos(b),.42*math.sin(b),2.8),
                 v(x+.01*math.cos(b),.01*math.sin(b),2.82),
                 v(x+.01*math.cos(a),.01*math.sin(a),2.82))
prism(0,[(-1.3,.55,-2.1),(1.3,.55,-2.1),(2.2,.6,.1),
         (1.3,.45,2.65),(-1.3,.45,2.65),(-2.2,.6,.1)],
        [(-1.3,-.6,-2.1),(1.3,-.6,-2.1),(2.2,-.65,.1),
         (1.3,-.45,2.65),(-1.3,-.45,2.65),(-2.2,-.65,.1)])
prism(2,[(-.92,.58,-1.2),(.92,.58,-1.2),(.72,1.34,.6),
         (-.72,1.34,.6)],
        [(-.92,.5,-1.2),(.92,.5,-1.2),(.72,.5,.6),(-.72,.5,.6)])

boss_binary = bytearray()
boss_views, boss_accessors, boss_primitives = [], [], []
for material, vertices in enumerate(surfaces):
    if not vertices: continue
    offset = len(boss_binary)
    for position, normal in vertices:
        boss_binary.extend(struct.pack('<6f', *position, *normal))
    while len(boss_binary)%4: boss_binary.append(0)
    view_index = len(boss_views)
    boss_views.append({'buffer':0,'byteOffset':offset,'byteLength':len(vertices)*24,
                       'byteStride':24,'target':34962})
    positions = [p for p,_ in vertices]
    boss_accessors.extend([
        {'bufferView':view_index,'byteOffset':0,'componentType':5126,'count':len(vertices),
         'type':'VEC3','min':[min(p[i] for p in positions) for i in range(3)],
         'max':[max(p[i] for p in positions) for i in range(3)]},
        {'bufferView':view_index,'byteOffset':12,'componentType':5126,'count':len(vertices),'type':'VEC3'}
    ])
    boss_primitives.append({'attributes':{'POSITION':len(boss_accessors)-2,
                                           'NORMAL':len(boss_accessors)-1},
                            'material':material,'mode':4})
boss_mats = []
for name, color, metallic, roughness, emissive in boss_materials:
    item = {'name':name,'pbrMetallicRoughness':{'baseColorFactor':color,
            'metallicFactor':metallic,'roughnessFactor':roughness},'doubleSided':True}
    if emissive: item['emissiveFactor'] = emissive
    boss_mats.append(item)
boss_gltf = {'asset':{'version':'2.0','generator':'Nebula 3 procedural boss'},
             'buffers':[{'byteLength':len(boss_binary)}],
             'bufferViews':boss_views,'accessors':boss_accessors,'materials':boss_mats,
             'meshes':[{'name':'Phantom boss','primitives':boss_primitives}],
             'nodes':[{'mesh':0,'name':'Phantom boss'}],'scenes':[{'nodes':[0]}],'scene':0}
boss_json = json.dumps(boss_gltf,separators=(',',':')).encode()
boss_json += b' ' * (-len(boss_json)%4)
boss_output = OUTPUT.with_name('boss.glb')
with boss_output.open('wb') as file:
    file.write(struct.pack('<4sII',b'glTF',2,12+8+len(boss_json)+8+len(boss_binary)))
    file.write(struct.pack('<I4s',len(boss_json),b'JSON'))
    file.write(boss_json)
    file.write(struct.pack('<I4s',len(boss_binary),b'BIN\0'))
    file.write(boss_binary)
print(f'Created {boss_output} ({boss_output.stat().st_size} bytes)')
