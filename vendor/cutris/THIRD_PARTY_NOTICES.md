# Third-party notices

cutris is distributed under the MIT License in `LICENSE`.
The components listed here retain their own licenses and copyright notices.
Required upstream author attribution is preserved verbatim.

## BiRefNet

Source: https://github.com/ZhengPeng7/BiRefNet

Official model cards, each declaring MIT licensing:

- General: https://huggingface.co/ZhengPeng7/BiRefNet
- Lite: https://huggingface.co/ZhengPeng7/BiRefNet_lite

cutris downloads ONNX conversions from the rembg public model release.
The model files are not embedded in the application executable or installer.

MIT License

Copyright (c) 2024 ZhengPeng

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## rembg

Model download/checksum and input normalization references:
https://github.com/danielgatis/rembg

MIT License

Copyright (c) 2020 Daniel Gatis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Binary distributions

Binary releases also bundle Python, pywebview, FastAPI, Uvicorn,
python-multipart, Pillow, NumPy, SciPy, OpenCV, ONNX Runtime, and their
dependencies. The release build collects applicable installed license texts
and a package inventory into `_internal/licenses` in the app bundle. Keep that
directory with the application when redistributing it. This summary does not
replace the individual license texts.

Native libraries included inside a package wheel have their own notices.
For example, OpenCV wheel licenses can cover FFmpeg and other native
components, and numerical packages can bundle separately licensed math
libraries. Preserve the complete license files supplied with the exact wheels
used for a release, including corresponding-source information where present.

Microsoft Edge WebView2 is a separate runtime supplied by Microsoft and is
governed by Microsoft's runtime terms. The installer can offer its official
runtime setup when it is missing; it is not part of cutris's MIT code.

For source installations, installed package notices are available in the
virtual environment's package metadata. The build inventory identifies the
exact bundled versions for a particular binary release.

## Model download references

Public release: https://github.com/danielgatis/rembg/releases/tag/v0.0.0

The downloader uses fixed filenames, expected sizes, and pinned SHA-256
digests to detect incomplete or altered downloads before activation. The
published rembg MD5 references are also recorded in the model manifest.
Checksum validation is not a publisher code-signing certificate.
cutris executes ONNX models through ONNX Runtime; it does not execute
Python downloaded from these model repositories.
