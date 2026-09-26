"""Build the detailed, batched glTF mothership hull without external packages.

The animated core, command ring, turrets and collision zones remain in Three.js.
Coordinates match src/nebula3/capitalShip.ts before its scale of eight.
"""
import json
import math
import struct
from pathlib import Path

OUTPUT = Path(__file__).resolve().parents[1] / 'models' / 'mothership.glb'
ARMOR, PLATE, DARK, WINDOW, ENGINE = range(5)
surfaces = [[] for _ in range(5)]


def triangle(material, a, b, c):
    ab = [b[i] - a[i] for i in range(3)]
    ac = [c[i] - a[i] for i in range(3)]
    normal = (ab[1] * ac[2] - ab[2] * ac[1],
              ab[2] * ac[0] - ab[0] * ac[2],
              ab[0] * ac[1] - ab[1] * ac[0])
    length = math.sqrt(sum(value * value for value in normal))
    if length < 1e-8:
        return
    normal = tuple(value / length for value in normal)
    surfaces[material].extend(((a, normal), (b, normal), (c, normal)))


def quad(material, a, b, c, d):
    triangle(material, a, b, c)
    triangle(material, a, c, d)


def box(material, x, y, z, sx, sy, sz):
    x0, x1 = x - sx / 2, x + sx / 2
    y0, y1 = y - sy / 2, y + sy / 2
    z0, z1 = z - sz / 2, z + sz / 2
    quad(material, (x0,y1,z0), (x1,y1,z0), (x1,y1,z1), (x0,y1,z1))
    quad(material, (x1,y0,z0), (x0,y0,z0), (x0,y0,z1), (x1,y0,z1))
    quad(material, (x0,y0,z1), (x0,y1,z1), (x1,y1,z1), (x1,y0,z1))
    quad(material, (x1,y0,z0), (x1,y1,z0), (x0,y1,z0), (x0,y0,z0))
    quad(material, (x1,y0,z1), (x1,y1,z1), (x1,y1,z0), (x1,y0,z0))
    quad(material, (x0,y0,z0), (x0,y1,z0), (x0,y1,z1), (x0,y0,z1))


def polygon_prism(material, points, top, bottom):
    for i, (x, z) in enumerate(points):
        nx, nz = points[(i + 1) % len(points)]
        quad(material, (x,top,z), (nx,top,nz), (nx,bottom,nz), (x,bottom,z))
    for i in range(1, len(points) - 1):
        triangle(material, (points[0][0],top,points[0][1]),
                 (points[i][0],top,points[i][1]),
                 (points[i+1][0],top,points[i+1][1]))
        triangle(material, (points[0][0],bottom,points[0][1]),
                 (points[i+1][0],bottom,points[i+1][1]),
                 (points[i][0],bottom,points[i][1]))


def tube(material, x, y, z0, z1, radius0, radius1, facets=12):
    for i in range(facets):
        a = 2 * math.pi * i / facets
        b = 2 * math.pi * (i + 1) / facets
        quad(material,
             (x+radius0*math.cos(a), y+radius0*math.sin(a), z0),
             (x+radius0*math.cos(b), y+radius0*math.sin(b), z0),
             (x+radius1*math.cos(b), y+radius1*math.sin(b), z1),
             (x+radius1*math.cos(a), y+radius1*math.sin(a), z1))
        triangle(material, (x,y,z1),
                 (x+radius1*math.cos(a), y+radius1*math.sin(a), z1),
                 (x+radius1*math.cos(b), y+radius1*math.sin(b), z1))


# Long faceted armored hull, from sharp bow to the broad aft machinery.
sections = [(18,.12,.12), (15,.85,.5), (11,1.8,.8), (6,3.3,1.4),
            (1,4.5,1.85), (-4,5.1,2), (-9,4.4,1.7), (-13,2.8,1.3)]
for front, back in zip(sections, sections[1:]):
    z0, w0, h0 = front
    z1, w1, h1 = back
    for i in range(8):
        a, b = (i + .5) * math.pi / 4, (i + 1.5) * math.pi / 4
        quad(ARMOR,
             (w0*math.cos(a),h0*math.sin(a),z0),
             (w0*math.cos(b),h0*math.sin(b),z0),
             (w1*math.cos(b),h1*math.sin(b),z1),
             (w1*math.cos(a),h1*math.sin(a),z1))
box(DARK, 0, -1.18, -3.9, 7.4, .54, 11.8)


def shape_at(z):
    ordered = list(reversed(sections))
    for (za, wa, ha), (zb, wb, hb) in zip(ordered, ordered[1:]):
        if za <= z <= zb:
            t = (z - za) / (zb - za)
            return wa + (wb - wa)*t, ha + (hb - ha)*t
    return (.3, .2)


# Raised dorsal armor is batched into one primitive per material. Narrow gaps
# and dark strips read as mechanical panel seams from gameplay distance.
for row in range(23):
    z = 11.3 - row * 1.02
    width, height = shape_at(z)
    for column in range(4):
        x = (column - 1.5) * width * .29
        y = height * (.92 - .18*max(0, abs(x)/width - .38))
        box(PLATE if (row + column) % 9 else ARMOR,
            x, y + .085, z, width * .25, .09, .82)
        if row % 4 == 0 and column in (0, 3):
            box(DARK, x, y + .14, z, width * .16, .015, .13)
    if row % 3 == 0:
        box(DARK, 0, height*.94+.16, z-.46, width*.7, .08, .08)

for side in (-1, 1):
    points = [(side*2.2,7), (side*7.2,2), (side*10.8,-8.5),
              (side*9.4,-10.5), (side*4,-8.5)]
    polygon_prism(PLATE, points, -.12, -.47)
    for z, x, span in [(1.2, side*5.2, 2.4), (-2, side*6.7, 3.5),
                       (-5.5, side*8, 3.8)]:
        box(ARMOR, x, -.07, z, span, .13, 1.55)
        box(DARK, x, .007, z+.76, span*.8, .018, .08)
    box(DARK, side*6.4, .07, -4.6, 2.9, .14, 4.6)
    box(ARMOR, side*6.1, .18, -4.3, 2.1, .11, 3.3)

    tube(ARMOR, side*8.25, -.55, -2, -11.95, 1.22, 1.43)
    tube(DARK, side*8.25, -.55, -11.94, -12.5, 1.63, 1.63)
    tube(ENGINE, side*8.25, -.55, -12.52, -12.55, 1.04, 1.04)
    for i in range(6):
        z = -2.7 - i*1.43
        tube(DARK, side*8.25, -.55, z, z-.14, 1.34, 1.34)
        box(PLATE, side*8.25, 1.0, z-.42, 1.35, .11, .8)
    for i in range(12):
        z = -8.3 + i*1.52
        width, _ = shape_at(z)
        box(DARK, side*(width*.9), -.57, z, .16, .45, .84)
        if i % 2 == 0:
            box(WINDOW, side*(width*.91), -.5, z+.13, .03, .15, .18)
    box(DARK, side*3.1, -1.34, -6, .35, .25, 8)
    for i in range(8):
        box(PLATE, side*(3.3+i*.18), -1.25, -9+i*1.35,
            .44, .12, .63)
    for i in range(3):
        box(WINDOW, side*4.5, .4, -2+i*2.3, .16, .16, .57)

# Layered bridge, navigation slit, heavy spine and scattered deck details.
box(DARK, 0, 2, -5.5, 5.7, .65, 5.2)
box(PLATE, 0, 3.2, -6.5, 5.6, 1.9, 3.8)
box(ARMOR, 0, 4.3, -6.7, 4.7, 1.55, 3.15)
box(DARK, 0, 5.2, -4.94, 4, .52, .18)
box(PLATE, 0, 5.55, -6.7, 3.7, 1.2, 2.55)
box(WINDOW, 0, 5.25, -4.82, 3.1, .22, .07)
box(ARMOR, 0, 6.32, -6.75, 2.9, .45, 2.16)
box(DARK, 0, 8.1, -6.8, .12, 2.9, .12)
box(PLATE, 0, 9.62, -6.8, 1.6, .12, .18)
box(DARK, 0, 1.04, 10.4, .45, .13, 8.5)
box(DARK, 0, 1.24, 8.8, 1.2, .14, 2.8)
for side in (-1,1):
    for i in range(6):
        z = -9 + i*1.18
        box(PLATE, side*1.9, 2.22, z, .92, .12, .5)
        box(DARK, side*1.9, 2.29, z+.29, .8, .02, .045)
    for i in range(4):
        box(DARK, side*2.35, 3.8, -8+i*.85, .12, .33, .5)

materials = [
    ('blue grey ceramic armor', [.27,.36,.43,1], .72, .46, [0,0,0]),
    ('raised titanium panels', [.47,.56,.61,1], .67, .49, [0,0,0]),
    ('recessed graphite', [.055,.085,.11,1], .52, .62, [0,0,0]),
    ('amber navigation windows', [.72,.24,.06,1], .24, .43, [.23,.055,.008]),
    ('ion engine exhaust', [.16,.49,.57,1], .30, .38, [.025,.22,.29]),
]

binary = bytearray()
views, accessors, primitives = [], [], []
for material_index, vertices in enumerate(surfaces):
    offset = len(binary)
    for position, normal in vertices:
        binary.extend(struct.pack('<6f', *position, *normal))
    while len(binary) % 4:
        binary.append(0)
    view = len(views)
    views.append({'buffer': 0, 'byteOffset': offset,
                  'byteLength': len(vertices)*24, 'byteStride': 24, 'target': 34962})
    positions = [p for p, _ in vertices]
    mins = [min(p[i] for p in positions) for i in range(3)]
    maxs = [max(p[i] for p in positions) for i in range(3)]
    first = len(accessors)
    accessors.extend([
        {'bufferView': view, 'byteOffset': 0, 'componentType': 5126,
         'count': len(vertices), 'type': 'VEC3', 'min': mins, 'max': maxs},
        {'bufferView': view, 'byteOffset': 12, 'componentType': 5126,
         'count': len(vertices), 'type': 'VEC3'},
    ])
    primitives.append({'attributes': {'POSITION': first, 'NORMAL': first+1},
                       'material': material_index, 'mode': 4})

asset = {
    'asset': {'version': '2.0', 'generator': 'Nebula 3 mothership geometry'},
    'scene': 0, 'scenes': [{'nodes': [0]}],
    'nodes': [{'mesh': 0, 'name': 'Armored capital ship hull'}],
    'meshes': [{'primitives': primitives}],
    'materials': [{'name': name, 'pbrMetallicRoughness': {
        'baseColorFactor': color, 'metallicFactor': metal, 'roughnessFactor': rough},
        'emissiveFactor': emissive, 'doubleSided': True}
        for name, color, metal, rough, emissive in materials],
    'buffers': [{'byteLength': len(binary)}],
    'bufferViews': views, 'accessors': accessors,
}
json_chunk = json.dumps(asset, separators=(',', ':')).encode('utf-8')
json_chunk += b' ' * (-len(json_chunk) % 4)
with OUTPUT.open('wb') as file:
    file.write(struct.pack('<4sII', b'glTF', 2,
                           12 + 8 + len(json_chunk) + 8 + len(binary)))
    file.write(struct.pack('<I4s', len(json_chunk), b'JSON'))
    file.write(json_chunk)
    file.write(struct.pack('<I4s', len(binary), b'BIN\0'))
    file.write(binary)
print(f'{OUTPUT.name}: {OUTPUT.stat().st_size:,} bytes, '
      f'{sum(len(vertices)//3 for vertices in surfaces):,} triangles, '
      f'{len(primitives)} materials')
