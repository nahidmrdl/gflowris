"""Import a Cutris PNG and build clean desktop, web, and extension icons."""
import argparse
from pathlib import Path
from PIL import Image, ImageOps

ROOT=Path(__file__).resolve().parents[1]
SIZES=(16,20,24,32,40,48,64,96,128,256)

def resize(image,size):
    result=image.convert('RGBa').resize((size,size),Image.Resampling.LANCZOS).convert('RGBA')
    return Image.frombytes('RGBA',result.size,result.tobytes())

def build(source):
    with Image.open(source) as image:
        image=ImageOps.exif_transpose(image).convert('RGBA')
        bounds=image.getchannel('A').getbbox()
        if not bounds:raise ValueError('The icon is empty.')
        image=ImageOps.contain(image.crop(bounds),(960,960),Image.Resampling.LANCZOS)
        master=Image.new('RGBA',(1024,1024))
        master.alpha_composite(image,((1024-image.width)//2,(1024-image.height)//2))
    assets=ROOT/'assets';web=ROOT/'public'/'assets';extension=ROOT/'extension'/'icons'
    for folder in (assets,web,extension):folder.mkdir(parents=True,exist_ok=True)
    master.save(assets/'icon-master.png',optimize=True)
    frames=[resize(master,size) for size in SIZES]
    frames[-1].save(assets/'app.ico',format='ICO',sizes=[frame.size for frame in frames],append_images=frames[:-1])
    (web/'favicon.ico').write_bytes((assets/'app.ico').read_bytes())
    resize(master,256).save(web/'app-256.png',optimize=True)
    for size in (16,32,48,128):resize(master,size).save(extension/f'icon-{size}.png',optimize=True)
    print('Desktop, web, and extension icons generated without source metadata.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path)
    build(parser.parse_args().source)
