/*
Copyright (c) 2009 Kazuhiko Arase

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
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
// Bundled qrcode-generator 1.4.4 (MIT), followed by Darvazeh UI.
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));

'use strict';
const $=id=>document.getElementById(id);
const state={csrf:'',status:null,devices:[],history:[],summary:[],trials:[],tab:'overview',busy:false,refreshing:false,profiles:[],selected:new Set(),addRows:[]};
const knownTabs=['overview','add','devices','online','history','settings','ideas'];
const errorText={ADMIN_PASSWORD_MISSING:'ADMIN_PASSWORD به برنامه نرسیده است. آن را در Envs ثبت و اپ را Restart کنید.',ADMIN_PASSWORD_TOO_SHORT:'رمز مدیر کمتر از ۱۶ کاراکتر است. ورود امن تا اصلاح آن غیرفعال می‌ماند.',AUTH_INITIALIZATION_FAILED:'آماده‌سازی ورود امن ناموفق است.',PUBLIC_DOMAIN_MISSING:'PUBLIC_DOMAIN به برنامه نرسیده است.',PUBLIC_DOMAIN_INVALID:'دامنه باید فقط hostname باشد؛ بدون http، مسیر یا قالب لینک.',STORAGE_UNAVAILABLE_OR_INVALID:'داده یا Volume قابل استفاده نیست. فایل قبلی خودکار حذف یا بازنویسی نشده است.',XRAY_NOT_FOUND:'باینری Xray پیدا نشد؛ ایمیج را بررسی کنید.',XRAY_VALIDATION_TIMEOUT:'بررسی تنظیمات هسته بیش از زمان مجاز طول کشید.',XRAY_CONFIG_REJECTED:'Xray تنظیمات را نپذیرفت.',CORE_IO_ERROR:'خطای دسترسی به فایل یا اجرای هسته.',XRAY_START_FAILED:'راه‌اندازی هسته ناموفق بود.',HISTORY_STORAGE_FAILED:'دیتابیس آمار آماده نیست؛ دستگاه‌های دارای سهمیه مجاز به اتصال نخواهند بود.',MONITOR_TRUST_CONFIG_INVALID:'تنظیم پراکسی مورد اعتماد نامعتبر است.',MONITOR_RELAY_UNAVAILABLE:'واسط پایش اجرا نشد. گزارش عیب‌یابی را بررسی کنید.'};
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=text;if(cls)n.className=cls;return n}
function notify(text,type='info'){$('message').className='message '+type;$('messageText').textContent=text}
function fmtNumber(n){return new Intl.NumberFormat('fa-IR',{maximumFractionDigits:1}).format(n)}
function bytes(n){if(n===null||n===undefined)return 'نامشخص';n=Number(n);const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1000&&i<4){n/=1000;i++}return n.toFixed(i?1:0)+' '+u[i]}
function when(t){return t?new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',dateStyle:'short',timeStyle:'medium'}).format(new Date(t*1000)):'هنوز ثبت نشده'}
function pill(text,color='neutral'){const p=el('span',null,'pill '+color);p.append(el('i',null,'dot '+color),el('span',text));return p}
function summaryFor(d){return state.summary.find(x=>x.device_id===d.id)||{active_connections:0,last_seen:null}}
function statusFor(d){if(!d.enabled||d.reason==='disabled')return ['غیرفعال','bad'];if(d.reason==='expired')return ['اعتبار تمام شده','warn'];if(d.reason==='exhausted')return ['سهمیه تمام شده','bad'];if(d.reason)return ['پایش در دسترس نیست','warn'];return summaryFor(d).active_connections>0?['متصل','good']:['بدون اتصال','neutral']}
function signedOut(){state.csrf='';state.devices=[];state.history=[];$('dashboard').classList.add('hidden');$('tabs').classList.add('hidden');$('logout').classList.add('hidden');$('login').classList.remove('hidden');closeModal(true)}
async function api(path,body){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);try{const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});const value=await r.json();if(!r.ok){if(r.status===401)signedOut();throw Error(value.error||'درخواست ناموفق بود')}return value}finally{clearTimeout(timer)}}
function renderSetup(codes,initializing){$('setup').replaceChildren();for(const code of codes)$('setup').append(el('p',errorText[code]||code));if(initializing)$('setup').append(el('p','پنل آماده است؛ بررسی اولیهٔ هسته در جریان است…'));$('setup').classList.toggle('hidden',!codes.length&&!initializing)}
async function boot(){try{const b=await api('bootstrap');$('password').disabled=!b.login_enabled;$('loginForm').querySelector('button').disabled=!b.login_enabled;renderSetup(b.errors,b.initializing);await refresh()}catch(e){notify('ارتباط با پنل برقرار نشد: '+e.message,'error')}}
function tab(name){state.tab=knownTabs.includes(name)?name:'overview';for(const t of knownTabs){$('view-'+t).classList.toggle('hidden',t!==state.tab);$('tab-'+t).setAttribute('aria-selected',String(t===state.tab));$('tab-'+t).tabIndex=t===state.tab?0:-1}if(location.hash!=='#'+state.tab)history.replaceState(null,'','#'+state.tab)}
async function refresh(){if(state.refreshing)return;state.refreshing=true;try{const s=await api('status');state.status=s;state.csrf=s.csrf;$('login').classList.add('hidden');$('dashboard').classList.remove('hidden');$('tabs').classList.remove('hidden');$('logout').classList.remove('hidden');$('demo').classList.toggle('hidden',s.mode!=='demo');renderSetup(s.setup_errors||[],s.initializing);state.devices=(await api('devices')).devices;
try{const h=await api('history?device='+encodeURIComponent($('deviceFilter').value)+'&state='+encodeURIComponent($('stateFilter').value));state.history=h.connections;state.summary=h.summary;state.trials=h.trials}catch(e){state.history=[];state.summary=[];state.trials=[];notify(e.message,'error')}
if(!state.profiles.length)state.profiles=(await api('profiles')).items;
render();}catch(e){if(state.csrf)notify('دریافت وضعیت ناموفق: '+e.message,'error')}finally{state.refreshing=false}}
function render(){const s=state.status;const monitor=s.monitor||{};
$('headerHealth').replaceWith(Object.assign(pill(s.mode==='demo'?'حالت نمایشی':s.core_running?'هسته در حال اجرا':'هسته متوقف',s.core_running?'good':'warn'),{id:'headerHealth'}));
$('core').textContent=s.initializing?'در حال بررسی':s.mode==='demo'?'نمایشی':s.core_running?'در حال اجرا':'متوقف';$('core').style.color=s.core_running?'var(--green)':'var(--amber)';$('domain').textContent=s.domain;$('uptime').textContent=fmtNumber(Math.floor(s.uptime_seconds/60))+' دقیقه';$('memory').textContent='بیشینهٔ حافظهٔ پنل: '+s.panel_memory_mb+' MB';
const online=state.devices.filter(d=>summaryFor(d).active_connections>0).length;$('onlineMetric').textContent=fmtNumber(online);$('onlineCount').textContent=fmtNumber(online);$('deviceCount').textContent=fmtNumber(state.devices.length);$('connectionCount').textContent=fmtNumber(state.summary.reduce((n,d)=>n+d.active_connections,0))+' اتصال باز';$('totalUsage').textContent=state.devices.some(d=>d.used_bytes===null)?'نامشخص':bytes(state.devices.reduce((n,d)=>n+(d.used_bytes||0),0));
$('monitorBadge').replaceWith(Object.assign(pill(monitor.ready?'روشن':'خاموش / آماده نیست',monitor.ready?'good':'warn'),{id:'monitorBadge'}));$('monitorState').textContent=(monitor.error?(errorText[monitor.error]||monitor.error):monitor.enabled?'تاریخچهٔ خصوصی تا ۷ روز؛ شمارندهٔ سهمیه مستقل و ماندگار است.':'پایش خاموش یا حالت نمایشی است.')+(!monitor.trusted_proxy_configured?' IP واقعی: زنجیرهٔ پراکسی تأیید نشده.':'')+(!monitor.geo_available?' بانک کشور محلی نصب نیست.':'')+(monitor.persistence_error?' هشدار: خطای ثبت بخشی از آمار؛ دستگاه محدود در خطای شمارنده قطع می‌شود.':'');
$('logLevel').textContent=({warning:'هشدار',error:'فقط خطا',none:'خاموش'})[s.loglevel]||s.loglevel;
$('events').replaceChildren();for(const e of s.events.slice().reverse()){const row=el('div',null,'event');row.append(el('span',errorText[e.message]||e.message),el('time',when(Date.parse(e.time)/1000)));$('events').append(row)}
const selected=$('deviceFilter').value;$('deviceFilter').replaceChildren(new Option('همه',''));state.devices.forEach(d=>$('deviceFilter').add(new Option(d.name,d.id)));$('deviceFilter').value=selected;
renderDevices();renderHistory();renderProfiles()}
function actionButton(text,fn,cls='secondary'){const b=el('button',text,cls);b.type='button';b.onclick=fn;return b}
function emptyRows(body,cols,title,detail){const tr=el('tr'),td=el('td',null,'empty');td.colSpan=cols;td.append(el('strong',title),el('span',detail));tr.append(td);body.append(tr)}
function cell(row,content){const n=el('td');if(content instanceof Node)n.append(content);else n.textContent=content;row.append(n);return n}
function renderDevices(){const tables=[['deviceRows',filteredDevices(),true],['onlineRows',state.devices.filter(d=>summaryFor(d).active_connections>0),false]];for(const [id,items,selectable] of tables){const tbody=$(id);tbody.replaceChildren();for(const d of items){const tr=el('tr');if(selectable){const pick=el('td',null,'select-cell'),box=el('input');box.type='checkbox';box.checked=state.selected.has(d.id);box.setAttribute('aria-label','انتخاب '+d.name);box.onchange=()=>{if(box.checked)state.selected.add(d.id);else state.selected.delete(d.id);syncSelection()};pick.append(box);tr.append(pick)}const name=el('div',null,'device-idblock'),info=el('div');name.append(el('span','▣','device-avatar'),info);info.append(el('span',d.name,'device-name'),pill(...statusFor(d)));if(d.legacy)info.append(el('small','لینک قبلی حفظ شده','muted-small'));cell(tr,name);
const usage=el('div'),head=el('div',null,'meter-head'),used=d.used_bytes,limit=d.quota_bytes||0;const cap=el('span',limit?'از ':'نامحدود','muted');if(limit)cap.append(el('bdi',bytes(limit),'latin'));head.append(el('b',bytes(used),'latin'),cap);const progress=el('div',null,'meter '+(!limit?'unlimited':used>=limit?'bad':used/limit>=.8?'warn':''));const fill=el('span');fill.style.width=limit&&used!==null?Math.min(100,used/limit*100)+'%':'0%';progress.append(fill);if(limit&&used!==null){progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','مصرف '+d.name);progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');progress.setAttribute('aria-valuenow',String(Math.min(100,Math.floor(used/limit*100))))}const remaining=el('small',limit?'باقی‌مانده: ':'ارسال + دریافت · سقف تعیین نشده','muted-small');if(limit)remaining.append(el('bdi',bytes(d.remaining_bytes),'latin'));const percent=el('div',limit&&Number.isFinite(used)?fmtNumber(Math.min(100,Math.max(0,used/limit*100)))+'٪ مصرف‌شده · '+fmtNumber(Math.max(0,100-used/limit*100))+'٪ باقی‌مانده':limit?'درصد مصرف نامشخص':'بدون سقف · درصد ندارد','meter-percent');usage.append(head,progress,percent,remaining);if(d.basis==='retained-history')usage.append(el('small','مبنای اولیه: تاریخچهٔ باقی‌مانده','muted-small'));cell(tr,usage);
const time=el('div');time.append(el('span',d.duration_days?fmtNumber(d.duration_days)+' روز از اولین اتصال':'بدون انقضا'),el('small',d.expires_at?'انقضای دقیق: '+when(d.expires_at)+' (تهران)':d.duration_days?'هنوز شروع نشده':'اولین مشاهده: '+when(d.first_seen),'muted-small'));cell(tr,time);
const stats=summaryFor(d),activity=el('div');activity.append(el('b',fmtNumber(stats.active_connections)+' اتصال'),el('small',when(stats.last_seen),'muted-small'));cell(tr,activity);const acts=el('div',null,'row-actions');acts.append(actionButton('لینک',()=>linkModal(d),'link-button'),actionButton('کپی',()=>copyLink(d),'copy-button'),actionButton('QR',()=>linkModal(d),'qr-button'),actionButton('⋯',()=>moreModal(d),'more-button'));acts.lastChild.setAttribute('aria-label','عملیات '+d.name);cell(tr,acts);tbody.append(tr)}if(!items.length)emptyRows(tbody,selectable?6:5,id==='onlineRows'?'فعلاً دستگاه متصلی مشاهده نمی‌شود.':'دستگاهی پیدا نشد.',id==='onlineRows'?'این بخش بر اساس اتصال باز است، نه صرفاً فعال‌بودن اعتبار.':'از تب «افزودن دستگاه» استفاده کنید یا جست‌وجو را تغییر دهید.')}syncSelection();renderStaged()}
function renderHistory(){$('historyRows').replaceChildren();for(const c of state.history){const tr=el('tr');cell(tr,state.devices.find(d=>d.id===c.device_id)?.name||'دستگاه سابق');const ip=el('div');ip.append(el('span',c.client_ip||'IP نامشخص','latin'),el('small',(c.country||'کشور نامشخص')+(!c.client_ip?' · واسط: '+(c.peer_ip||'—'):''),'muted-small'));cell(tr,ip);cell(tr,when(c.started));cell(tr,when(c.ended||c.last_seen));cell(tr,fmtNumber(c.duration_seconds)+' ثانیه');const traffic=el('span',bytes(c.up)+' / '+bytes(c.down),'latin');cell(tr,traffic);cell(tr,pill(...({active:['باز','good'],closed:['بسته','neutral'],interrupted:['پایان نامشخص','warn']})[c.state]));$('historyRows').append(tr)}if(!state.history.length)emptyRows($('historyRows'),7,'هنوز اتصال قابل‌نمایشی ثبت نشده است.','اتصال جدید یا فیلتر دیگری را بررسی کنید؛ دادهٔ ساختگی تولید نمی‌شود.')}
function renderProfiles(){$('profiles').replaceChildren();for(const p of state.profiles){const card=el('div',null,'profile');card.append(el('h3',p.name),pill(({available:'مسیر فعلی',manual:'تنظیم دستی', 'not-deployed':'فعال نشده'})[p.state],p.state==='available'?'good':'neutral'),el('p',p.description));$('profiles').append(card)}$('trialRows').replaceChildren();state.trials.forEach(t=>{const row=el('div',null,'event');row.append(el('span',[t.network,t.client,({working:'کار کرد',failed:'ناموفق',unstable:'ناپایدار'})[t.result],t.latency_ms===null?'':t.latency_ms+' ms'].join(' · ')),el('time',when(t.created)));$('trialRows').append(row)})}
// All confirmations and edits use a single accessible in-app dialog.
let modalHandler=null,lastFocus=null,modalBusy=false;
function closeModal(force=false){if(modalBusy&&!force)return;if($('modal').open){if(typeof $('modal').close==='function')$('modal').close();else $('modal').removeAttribute('open')}$('modalBody').replaceChildren();modalHandler=null;if(lastFocus?.isConnected)lastFocus.focus()}
function openModal(title,description,content,onSubmit,label='ذخیرهٔ تغییرات',danger=false){if(state.busy)return;closeModal();lastFocus=document.activeElement;$('modalTitle').textContent=title;$('modalDescription').textContent=description;$('modalBody').replaceChildren(content);$('modalError').classList.add('hidden');$('modalSubmit').textContent=label;$('modalSubmit').className=danger?'danger-button':'primary';$('modalSubmit').classList.toggle('hidden',!onSubmit);$('modalCancel').textContent=onSubmit?'انصراف':'بستن';modalHandler=onSubmit;if(typeof $('modal').showModal==='function')$('modal').showModal();else $('modal').setAttribute('open','');setTimeout(()=>$('modalBody').querySelector('input,select,textarea,button')?.focus(),0)}
function field(id,label,type='text',value='',hint=''){const wrap=el('div',null,'field'),lab=el('label',label);lab.htmlFor=id;const input=el('input');input.id=id;input.type=type;input.value=value;wrap.append(lab,input);if(hint)wrap.append(el('small',hint,'hint'));return {wrap,input}}
function selectField(id,label,options,value){const wrap=el('div',null,'field'),lab=el('label',label);lab.htmlFor=id;const input=el('select');input.id=id;options.forEach(([v,t])=>input.add(new Option(t,v)));input.value=value;wrap.append(lab,input);return {wrap,input}}
function checkField(id,label,checked=false){const wrap=el('div',null,'check-row'),input=el('input');input.type='checkbox';input.id=id;input.checked=checked;const lab=el('label',label);lab.htmlFor=id;wrap.append(input,lab);return {wrap,input}}
async function mutate(path,value){notify('در حال اعمال تغییرات…','busy');await api(path,value);await refresh();notify('عملیات با موفقیت انجام شد.','success')}
function confirmModal(title,description,callback,danger=false,label='تأیید و ادامه'){openModal(title,description,el('div'),callback,label,danger)}
function editModal(d=null){const content=el('div'),name=field('editName','نام دستگاه / کاربر','text',d?.name||'');name.input.required=true;name.input.maxLength=80;content.append(name.wrap);const grid=el('div',null,'form-grid'),quota=field('editQuota','سقف مصرف (GB)','number',d?(d.quota_bytes||0)/1e9:50,'پیش‌فرض ۵۰ گیگابایت. هر GB برابر ۱٬۰۰۰٬۰۰۰٬۰۰۰ بایت است. صفر = نامحدود.'),days=field('editDays','اعتبار از اولین اتصال (روز)','number',d?.duration_days??30,'پیش‌فرض ۳۰ روز. روز تقویمی؛ نه مجموع ساعت‌های آنلاین. صفر = بدون انقضا.');quota.input.min=0;quota.input.max=1000000;quota.input.step='any';quota.input.required=true;days.input.min=0;days.input.max=36500;days.input.step='1';days.input.required=true;grid.append(quota.wrap,days.wrap);content.append(grid);const expiry=el('p',null,'modal-info');expiry.id='expiryPreview';content.append(expiry);const updateExpiry=()=>{const n=Number(days.input.value);expiry.textContent=!days.input.value||!Number.isInteger(n)||n<0||n>36500?'مدت معتبر وارد کنید.':n===0?'بدون انقضا':d?.first_seen?'انقضای دقیق: '+when(d.first_seen+n*86400)+' (تهران)':'انقضای تخمینی در صورت اولین اتصال همین حالا: '+when(Date.now()/1000+n*86400)+' (تهران). تاریخ قطعی پس از اولین اتصال مشخص می‌شود.'};days.input.addEventListener('input',updateExpiry);updateExpiry();if(d)content.append(el('p','مصرف شمارش‌شده: '+bytes(d.used_bytes)+' · اولین مشاهده: '+when(d.first_seen)+'. ویرایش، مصرف یا شروع اعتبار را صفر نمی‌کند.','modal-info'));content.append(el('p','در اتمام سهمیه یا اعتبار، اتصال‌های این دستگاه قطع می‌شوند. ذخیرهٔ این تغییر در نسخهٔ فعلی هسته را بازراه‌اندازی می‌کند.','notice'));openModal(d?'ویرایش دستگاه':'افزودن دستگاه',d?'لینک فعلی حفظ می‌شود؛ سقف کمتر از مصرف فعلی می‌تواند دستگاه را فوراً مسدود کند.':'برای هر دستگاه یک نام و لینک مستقل بسازید.',content,async()=>{const bytesValue=Math.round(Number(quota.input.value)*1e9);if(!Number.isSafeInteger(bytesValue))throw Error('حجم نامعتبر است');const data={name:name.input.value,quota_bytes:bytesValue,duration_days:Number(days.input.value)};if(d)Object.assign(data,{id:d.id,operation:'edit'});const previous=new Set(state.devices.map(x=>x.id));await mutate(d?'device':'devices',data);if(!d){const created=state.devices.filter(x=>!previous.has(x.id)&&x.name===data.name.trim());if(created.length===1)return ()=>linkModal(created[0])}},d?'ذخیرهٔ تغییرات':'ساخت دستگاه')}
function moreModal(d){const content=el('div',null,'modal-menu');content.append(actionButton('ویرایش نام، سهمیه و اعتبار',()=>{closeModal();editModal(d)}),actionButton(d.enabled?'غیرفعال‌کردن دستگاه':'فعال‌کردن دستگاه',()=>{closeModal();confirmModal(d.enabled?'غیرفعال‌کردن دستگاه':'فعال‌کردن دستگاه','تغییر وضعیت هسته را بازراه‌اندازی می‌کند. فعال‌کردن، سهمیه یا تاریخ انقضا را تمدید نمی‌کند.',()=>mutate('device',{id:d.id,operation:d.enabled?'disable':'enable'}),d.enabled)}),actionButton('تعویض کلید اتصال',()=>{closeModal();confirmModal('تعویض کلید اتصال','لینک قبلی این دستگاه باطل می‌شود؛ مصرف و اعتبار زمانی حفظ می‌شوند. اتصال‌های جاری بازراه‌اندازی می‌شوند.',()=>mutate('device',{id:d.id,operation:'rotate'}),true)},'danger-button'));if(d.legacy)content.append(el('p','حذف دستگاه «اتصال قبلی» ممکن نیست؛ کلید اصلی همین فایل است. می‌توانید غیرفعالش کنید یا کلیدش را تعویض کنید.','modal-info'));else content.append(actionButton('حذف دستگاه',()=>{closeModal();confirmModal('حذف دستگاه','دستگاه «'+d.name+'» و لینکش حذف می‌شوند. مصرف و تاریخچهٔ ثبت‌شده حفظ می‌شود و بقیهٔ دستگاه‌ها تغییری نمی‌کنند. حذف برگشت‌پذیر نیست.',()=>mutate('device',{id:d.id,operation:'delete'}),true,'حذف قطعی')},'danger-button'));openModal('مدیریت دستگاه',d.name,content,null)}

function qrPanel(link){
 const panel=el('div',null,'qr-panel');
 try{
  const code=qrcode(0,'M');code.addData(link);code.make();
  const n=code.getModuleCount(),ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${n+8} ${n+8}`);svg.setAttribute('width','320');svg.setAttribute('height','320');svg.setAttribute('role','img');svg.setAttribute('aria-label','QR خصوصی لینک اتصال');svg.setAttribute('shape-rendering','crispEdges');svg.classList.add('qr-image');
  const background=document.createElementNS(ns,'rect');background.setAttribute('width','100%');background.setAttribute('height','100%');background.setAttribute('fill','#fff');svg.append(background);
  let path='';for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(code.isDark(r,c))path+=`M${c+4},${r+4}h1v1h-1z`;
  const pixels=document.createElementNS(ns,'path');pixels.setAttribute('d',path);pixels.setAttribute('fill','#000');svg.append(pixels);
  panel.append(svg,el('small','برای ورود به کلاینت اسکن کنید؛ این تصویر مانند لینک محرمانه است. ساخت QR کاملاً داخل مرورگر انجام می‌شود.','hint'),actionButton('دانلود تصویر QR',()=>{const blob=new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='darvazeh-private-qr.svg';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}));
 }catch{panel.append(el('p','ساخت QR برای این لینک ممکن نشد؛ از کپی لینک استفاده کنید.','notice'))}
 return panel;
}

async function linkModal(d){if(!d)return;try{const link=(await api('link?device='+encodeURIComponent(d.id))).link;const content=el('div'),area=el('textarea');area.className='link-area';area.id='link';area.readOnly=true;area.value=link;area.setAttribute('aria-label','لینک خصوصی اتصال');content.append(qrPanel(link),area,actionButton('کپی لینک',async()=>{try{await navigator.clipboard.writeText(link);notify('لینک کپی شد. آن را خصوصی نگه دارید.','success')}catch{area.focus();area.select();notify('کپی خودکار در دسترس نیست؛ متن انتخاب‌شده را کپی کنید.')}}));openModal('لینک و QR اختصاصی',d.name+' · این لینک محرمانه است و فقط روی دستگاه موردنظر وارد شود.',content,null)}catch(e){notify(e.message,'error')}}
function saveFile(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function serverModal(){const f=selectField('editLevel','سطح ثبت خطای هسته',[['warning','هشدار · پیش‌فرض'],['error','فقط خطا'],['none','خاموش']],state.status.loglevel);openModal('تنظیمات هستهٔ سرور','اعمال تنظیمات، اتصال‌های جاری را لحظه‌ای قطع می‌کند. خروجی خام دارای اطلاعات ترافیک ذخیره نمی‌شود.',f.wrap,()=>mutate('settings',{loglevel:f.input.value}),'اعمال و راه‌اندازی مجدد')}
function rangeValue(value,min,max){if(!/^\d+(?:-\d+)?$/.test(value))throw Error('بازه باید مانند 100-200 باشد');const [a,b=a]=value.split('-').map(Number);if(a<min||b>max||a>b)throw Error('بازه خارج از محدوده است');return value}
function buildClientConfig(link,options){const uri=new URL(link);if(uri.protocol!=='vless:')throw Error('لینک نامعتبر');const port=Number(options.port);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('پورت محلی نامعتبر');const concurrency=Number(options.concurrency)||8;if(!Number.isInteger(concurrency)||concurrency<1||concurrency>32)throw Error('تعداد جریان Mux نامعتبر');const stream={network:'ws',security:'tls',tlsSettings:{serverName:uri.searchParams.get('sni'),fingerprint:'chrome',allowInsecure:false},wsSettings:{path:uri.searchParams.get('path')||'/connect',headers:{Host:uri.searchParams.get('host')}}};const proxy={tag:'proxy',protocol:'vless',settings:{vnext:[{address:uri.hostname,port:Number(uri.port)||443,users:[{id:decodeURIComponent(uri.username),encryption:'none'}]}]},streamSettings:stream,mux:{enabled:Boolean(options.mux),concurrency}};const outbounds=[proxy];if(options.fragment){stream.sockopt={dialerProxy:'fragment'};outbounds.push({tag:'fragment',protocol:'freedom',settings:{domainStrategy:options.ipv4?'UseIPv4':'AsIs',fragment:{packets:'tlshello',length:rangeValue(options.length,1,65535),interval:rangeValue(options.interval,0,1000)}}})}else if(options.ipv4){stream.sockopt={domainStrategy:'UseIPv4'}}return {log:{loglevel:'warning'},inbounds:[{listen:'127.0.0.1',port,protocol:'socks',settings:{auth:'noauth',udp:true}}],outbounds}}
window.buildClientConfig=buildClientConfig;
function clientModal(){const enabled=state.devices.filter(d=>d.enabled&&!d.reason);if(!enabled.length){notify('ابتدا یک دستگاه مجاز برای دریافت پروفایل لازم است.','error');return}const content=el('div'),device=selectField('profileDevice','دستگاه',enabled.map(d=>[d.id,d.name]),enabled[0].id),fragment=checkField('profileFragment','Fragment آزمایشی · فقط tlshello',false),mux=checkField('profileMux','Mux · چندجریانی، پیش‌فرض خاموش',false),ipv4=checkField('profileIPv4','ترجیح IPv4 برای اتصال به سرور',false),port=field('profilePort','پورت SOCKS محلی','number',10818,'این خروجی مستقل است؛ پورت نباید با برنامهٔ دیگری تداخل داشته باشد.'),concurrency=field('profileConcurrency','تعداد جریان Mux','number',8),length=field('profileLength','طول Fragment (بایت)','text','100-200'),interval=field('profileInterval','فاصلهٔ Fragment (میلی‌ثانیه)','text','10-20');port.input.min=1024;port.input.max=65535;concurrency.input.min=1;concurrency.input.max=32;const grid=el('div',null,'form-grid');grid.append(length.wrap,interval.wrap,port.wrap,concurrency.wrap);content.append(device.wrap,actionButton('QR لینک پایهٔ دستگاه انتخاب‌شده',()=>linkModal(state.devices.find(d=>d.id===device.input.value))),el('small','QR لینک پایه شامل تغییرات Fragment و Mux این فرم نیست.','hint'),fragment.wrap,mux.wrap,ipv4.wrap,grid,el('p','بازه‌های Fragment نمونهٔ مستندات Xray هستند، نه مقدار تضمین‌شده برای همراه اول. TLS با بررسی گواهی روشن می‌ماند. DNS سیستم تغییر نمی‌کند.','modal-info'));const sync=()=>{length.input.disabled=interval.input.disabled=!fragment.input.checked;concurrency.input.disabled=!mux.input.checked};fragment.input.onchange=mux.input.onchange=sync;sync();openModal('تنظیم پروفایل کلاینت','خروجی خصوصی Xray-core JSON؛ روی سرور و کلاینت فعال شما اعمال نمی‌شود. سازگاری Custom Config با نسخهٔ کلاینت را جدا بررسی کنید.',content,async()=>{const link=(await api('link?device='+encodeURIComponent(device.input.value))).link;const result=buildClientConfig(link,{port:port.input.value,mux:mux.input.checked,concurrency:concurrency.input.value,fragment:fragment.input.checked,length:length.input.value,interval:interval.input.value,ipv4:ipv4.input.checked});saveFile('darvazeh-private-xray-client.json',result);notify('فایل خصوصی کلاینت آماده شد؛ تنظیمات سرور تغییر نکرد.','success');return false},'دانلود پروفایل خصوصی')}
function trialModal(){const content=el('div'),network=field('trialNetwork','شبکه / اپراتور'),client=field('trialClient','کلاینت و نسخه'),profile=selectField('trialProfile','پروفایل',[['ws-baseline','WS فعلی'],['ws-client-tuning','تنظیمات کلاینت'],['xhttp-research','XHTTP در محیط مستقل']], 'ws-baseline'),result=selectField('trialResult','نتیجه',[['working','کار کرد'],['unstable','ناپایدار'],['failed','وصل نشد']],'working'),latency=field('trialLatency','تأخیر اختیاری (ms)','number');network.input.required=client.input.required=true;network.input.maxLength=client.input.maxLength=80;latency.input.min=0;latency.input.max=600000;const grid=el('div',null,'form-grid');grid.append(network.wrap,client.wrap,profile.wrap,result.wrap,latency.wrap);content.append(grid);openModal('ثبت آزمایش اتصال','نتیجهٔ خودتان را ثبت کنید. این ورودی، گزارش دستی است و تنظیمات سرور را تغییر نمی‌دهد.',content,()=>mutate('trial',{network:network.input.value,client:client.input.value,profile:profile.input.value,result:result.input.value,latency_ms:latency.input.value===''?null:Number(latency.input.value)}),'ثبت نتیجه')}
$('modalForm').onsubmit=async e=>{e.preventDefault();if(modalBusy||!modalHandler)return;modalBusy=state.busy=true;$('modalSubmit').disabled=true;$('modalCancel').disabled=true;$('modalClose').disabled=true;$('modalError').classList.add('hidden');let followUp;try{const keep=await modalHandler();if(typeof keep==='function')followUp=keep;if(keep!==false)closeModal(true)}catch(err){$('modalError').textContent=err.message;$('modalError').classList.remove('hidden');notify(err.message,'error')}finally{modalBusy=state.busy=false;$('modalSubmit').disabled=false;$('modalCancel').disabled=false;$('modalClose').disabled=false}if(followUp)await followUp()};
$('modalClose').onclick=$('modalCancel').onclick=()=>closeModal();$('modal').addEventListener('cancel',e=>{e.preventDefault();closeModal()});$('modal').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeModal()}if(e.key==='Tab'){const focusable=Array.from($('modal').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')).filter(n=>!n.classList.contains('hidden'));const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}});
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('login',{password:$('password').value});$('password').value='';await refresh();notify('خوش آمدید؛ پنل به‌روز است.','success')}catch(err){notify(err.message,'error')}};
$('logout').onclick=()=>confirmModal('خروج از پنل','نشست مدیریت بسته می‌شود؛ اتصال VPN دستگاه‌ها تغییری نمی‌کند.',async()=>{await api('logout',{});signedOut();notify('از پنل خارج شدید.')},false,'خروج');
async function copyLink(d){try{const link=(await api('link?device='+encodeURIComponent(d.id))).link;try{await navigator.clipboard.writeText(link)}catch{const t=el('textarea');t.value=link;t.style.position='fixed';t.style.opacity='0';document.body.append(t);t.select();try{document.execCommand('copy')}finally{t.remove()}}notify('لینک «'+d.name+'» کپی شد. آن را خصوصی نگه دارید.','success')}catch(e){notify('کپی نشد: '+e.message,'error')}}
function filteredDevices(){const q=$('deviceSearch').value.trim().toLocaleLowerCase();return state.devices.filter(d=>d.name.toLocaleLowerCase().includes(q))}
function syncSelection(){const rows=filteredDevices().map(d=>d.id);for(const id of [...state.selected])if(!rows.includes(id))state.selected.delete(id);const all=$('selectAllDevices');if(all){all.checked=rows.length>0&&rows.every(id=>state.selected.has(id));all.indeterminate=!all.checked&&rows.some(id=>state.selected.has(id))}const n=state.selected.size;$('bulkBar').classList.toggle('hidden',!n);$('bulkCount').textContent=fmtNumber(n)+' دستگاه انتخاب شده';const legacy=state.selected.has('legacy');$('bulkDelete').disabled=legacy;$('bulkDeleteHint').classList.toggle('hidden',!legacy)}
function bulkAction(operation){const ids=[...state.selected];if(!ids.length)return;const count=fmtNumber(ids.length);const meta={delete:['حذف دسته‌ای','حذف'],enable:['فعال‌سازی دسته‌ای','فعال‌سازی'],disable:['غیرفعال‌سازی دسته‌ای','غیرفعال‌سازی']}[operation];const detail=operation==='delete'?'این '+count+' دستگاه و لینک‌هایشان حذف می‌شوند. مصرف، تاریخچه و بقیهٔ دستگاه‌ها دست‌نخورده می‌مانند. حذف برگشت‌پذیر نیست و اتصال‌های جاری این دستگاه‌ها قطع می‌شود.':operation==='enable'?'فعال‌سازی '+count+' دستگاه. فعال‌سازی سهمیه یا تاریخ انقضا را تمدید نمی‌کند و اتصال‌های جاری بازراه‌اندازی می‌شوند.':'غیرفعال‌سازی '+count+' دستگاه. اتصال‌های جاری قطع می‌شود؛ مصرف و اعتبار حفظ می‌شوند.';confirmModal(meta[0],detail,async()=>{state.selected.clear();await mutate('devices/bulk',{ids,operation})},operation==='delete',meta[1]+' '+count+' دستگاه')}
const ADD_PRESET={gb:50,days:30};
const CSV_ALIASES={name:['name','نام','دستگاه','کاربر','device'],gb:['quota_gb','gb','حجم','سقف','quota','size_gb'],days:['days','day','روز','مدت','اعتبار','duration','duration_days']};
function normalizeRow(raw){const name=String(raw.name==null?'':raw.name).trim();const gbRaw=raw.gb,daysRaw=raw.days;const gb=gbRaw===''||gbRaw==null?ADD_PRESET.gb:Number(gbRaw);const days=daysRaw===''||daysRaw==null?ADD_PRESET.days:Number(daysRaw);const errors=[];if(!name||name.length>80||/[\u0000-\u001f]/.test(name))errors.push('نام');if(!Number.isFinite(gb)||gb<0||gb>1e6)errors.push('حجم');if(!Number.isInteger(days)||days<0||days>36500)errors.push('مدت');return {name,gb:Number.isFinite(gb)?gb:0,days:Number.isFinite(days)?days:0,quota_bytes:errors.includes('حجم')?0:Math.round((Number.isFinite(gb)?gb:0)*1e9),errors}}
function addCapacity(){return 50-state.devices.length}
function stageRows(list,source){if(!Array.isArray(list)||!list.length){notify('ردیفی برای افزودن پیدا نشد.','error');return}let added=state.addRows.length+list.length>200?list.slice(0,Math.max(0,200-state.addRows.length)):list;for(const raw of added)state.addRows.push(Object.assign(normalizeRow(raw),{source}));renderStaged();const bad=added.filter(r=>normalizeRow(r).errors.length).length;notify('تحلیل شد: '+fmtNumber(added.length)+' ردیف'+(bad?' · '+fmtNumber(bad)+' ردیف نامعتبر (قرمز) — اصلاح یا حذفش کنید':'')+' به فهرست آمادهٔ افزودن اضافه شد.',bad?'error':'success')}
function renderStaged(){const body=$('stagedRows');body.replaceChildren();state.addRows.forEach((row,index)=>{const tr=el('tr');if(row.errors.length)tr.className='invalid-row';cell(tr,row.name||'—');cell(tr,row.errors.includes('حجم')?'—':(row.gb?fmtNumber(row.gb)+' GB':'نامحدود'));cell(tr,row.errors.includes('مدت')?'—':(row.days?fmtNumber(row.days)+' روز':'بدون انقضا'));const src=el('td');src.append(el('small',{table:'جدول دستی',csv:'CSV',code:'رشتهٔ کد'}[row.source]||'—','muted-small'));tr.append(src);const act=el('td');if(row.errors.length)act.append(el('small','نامعتبر: '+row.errors.join(' · '),'muted-small'));act.append(actionButton('حذف',()=>{state.addRows.splice(index,1);renderStaged()},'danger-button'));tr.append(act);body.append(tr)});const valid=state.addRows.filter(r=>!r.errors.length).length;$('stagedCount').textContent=fmtNumber(state.addRows.length);$('stagedValid').textContent=fmtNumber(valid);$('stagedCap').textContent=fmtNumber(Math.max(0,addCapacity()));$('importStaged').disabled=!valid||valid>addCapacity();if(!state.addRows.length)emptyRows(body,5,'فهرستی آمادهٔ افزودن نیست.','از یکی از سه روش بالا استفاده کنید.')}
const addDraft={rows:[{name:'',gb:String(ADD_PRESET.gb),days:String(ADD_PRESET.days)}]};
function renderDraft(){const body=$('draftRows');body.replaceChildren();addDraft.rows.forEach((row,index)=>{const tr=el('tr');[['name','text','مثلاً علی'],['gb','number','50'],['days','number','30']].forEach(([key,type,placeholder])=>{const td=el('td'),input=el('input');input.type=type;input.placeholder=placeholder;input.value=row[key];if(type==='number'){input.min=0;input.step=key==='days'?'1':'any';input.max=key==='days'?36500:1e6}if(key==='name')input.maxLength=80;input.oninput=()=>{row[key]=input.value};td.append(input);tr.append(td)});const status=el('td'),check=normalizeRow(row);status.append(check.errors.length?el('small','نامعتبر: '+check.errors.join(' · '),'muted-small'):el('small','آماده','muted-small'));tr.append(status);const act=el('td');act.append(actionButton('حذف',()=>{addDraft.rows.splice(index,1);if(!addDraft.rows.length)addDraft.rows.push({name:'',gb:String(ADD_PRESET.gb),days:String(ADD_PRESET.days)});renderDraft()},'danger-button'));tr.append(act);body.append(tr)})}
function parseCsv(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else quoted=false}else field+=c}else{if(c==='"')quoted=true;else if(c===','){row.push(field);field=''}else if(c==='\n'){row.push(field);rows.push(row);row=[];field=''}else if(c!=='\r')field+=c}}row.push(field);rows.push(row);return rows.filter(r=>r.some(c=>String(c).trim()!==''))}
function csvKey(header){const h=String(header).trim().toLocaleLowerCase().replace(/^\ufeff/,'');for(const [key,list] of Object.entries(CSV_ALIASES))if(list.some(a=>a.toLocaleLowerCase()===h))return key;return null}
function csvToRows(text){const rows=parseCsv(text);if(!rows.length)throw Error('متن CSV خالی است');const header=rows[0].map(csvKey);const hasHeader=header.some(Boolean);const out=[];for(const cells of (hasHeader?rows.slice(1):rows)){if(!cells.some(c=>String(c).trim()!==''))continue;if(hasHeader){const item={};header.forEach((key,index)=>{if(key)item[key]=String(cells[index]==null?'':cells[index]).trim()});out.push(item)}else out.push({name:String(cells[0]==null?'':cells[0]).trim(),gb:String(cells[1]==null?'':cells[1]).trim(),days:String(cells[2]==null?'':cells[2]).trim()})}return out}
function parseJsList(text){let i=0;const src=text;const fail=m=>{throw Error(m)};function skip(){for(;;){while(i<src.length&&/\s/.test(src[i]))i++;if(src[i]==='/'&&src[i+1]==='/'){while(i<src.length&&src[i]!=='\n')i++;continue}if(src[i]==='/'&&src[i+1]==='*'){i+=2;while(i<src.length&&!(src[i]==='*'&&src[i+1]==='/'))i++;i+=2;continue}break}}function str(q){i++;let out='';while(i<src.length){const c=src[i];if(c==='\\'){const n=src[i+1];i+=2;out+=n==='n'?'\n':n==='t'?'\t':n==='r'?'\r':n==='u'?String.fromCharCode(parseInt(src.slice(i,i+4),16)||0):n;if(n==='u')i+=4;continue}if(c===q){i++;return out}out+=c;i++}fail('رشته بسته نشده است')}function key(){skip();const c=src[i];if(c==='"'||c==="'")return str(c);const m=/^[^:\s]+/.exec(src.slice(i));if(!m)fail('کلید نامعتبر');i+=m[0].length;return m[0]}function value(){skip();const c=src[i];if(c==='['){i++;const arr=[];for(;;){skip();if(src[i]===']'){i++;return arr}arr.push(value());skip();if(src[i]===','){i++;continue}if(src[i]===']'){i++;return arr}fail('ساختار آرایه ناتمام است (کاما یا ] لازم است)')}}if(c==='{'){i++;const obj={};for(;;){skip();if(src[i]==='}'){i++;return obj}const k=key();skip();if(src[i]!==':')fail('بعد از کلید «:» لازم است');i++;obj[k]=value();skip();if(src[i]===','){i++;continue}if(src[i]==='}'){i++;return obj}fail('ساختار شیء ناتمام است (کاما یا } لازم است)')}}if(c==='"'||c==="'")return str(c);if(c==='-'||c==='+'||c==='.'||(c>='0'&&c<='9')){const m=/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(src.slice(i));if(!m)fail('عدد نامعتبر');i+=m[0].length;return Number(m[0])}const w=/^[^\s,:\]\[\}\{]+/.exec(src.slice(i));if(!w)fail('مقدار نامعتبر');i+=w[0].length;const t=w[0];if(t==='true')return true;if(t==='false')return false;if(t==='null'||t==='undefined')return null;return t}const v=value();skip();if(i<src.length)fail('متن اضافه بعد از پایان ساختار');return v}
function rowsFromObjects(value){let list=value;if(list&&typeof list==='object'&&!Array.isArray(list))list=list.devices||list.rows||[list];if(!Array.isArray(list))throw Error('ساختار باید آرایهٔ اشیاء باشد، مانند [{name:"علی",quota_gb:50,days:30}]');return list.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))return {name:'',gb:'',days:''};const get=(...keys)=>{for(const k of keys)if(k in item&&item[k]!=null)return item[k];return undefined};return {name:String(get('name','نام','device','label')==null?'':get('name','نام','device','label')).trim(),gb:get('quota_gb','gb','quota','حجم','size_gb'),days:get('days','duration_days','روز','مدت','duration')}})}
async function createdLinksModal(devices){const content=el('div'),list=el('div',null,'link-list');content.append(el('p','این لینک‌ها خصوصی‌اند؛ هر کدام را فقط به صاحب همان دستگاه بدهید. اعتبار از اولین اتصال شروع می‌شود.','modal-info'),list);openModal('لینک دستگاه‌های تازه','برای هر دستگاه یک نام و لینک مستقل ساخته شد.',content,null);for(const d of devices){const row=el('div',null,'link-row');row.append(el('b',d.name));const value=el('code','در حال دریافت…','latin');row.append(value,actionButton('کپی',()=>copyLink(d),'copy-button'));list.append(row);try{value.textContent=(await api('link?device='+encodeURIComponent(d.id))).link}catch{value.textContent='دریافت لینک ناموفق بود'}}}
async function importStaged(){const valid=state.addRows.filter(r=>!r.errors.length);if(!valid.length){notify('ردیف معتبری در فهرست نیست.','error');return}if(valid.length>addCapacity()){notify('ظرفیت باقی‌مانده '+fmtNumber(addCapacity())+' دستگاه است؛ ردیف کم کنید.','error');return}const payload=valid.map(r=>({name:r.name,quota_bytes:r.quota_bytes,duration_days:r.days}));const before=new Set(state.devices.map(x=>x.id));await mutate('devices/import',{devices:payload});const created=state.devices.filter(d=>!before.has(d.id));state.addRows=state.addRows.filter(r=>r.errors.length);renderStaged();if(created.length)createdLinksModal(created)}
$('dismissMessage').onclick=()=>$('message').classList.add('hidden');document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));$('tabs').addEventListener('keydown',e=>{const i=knownTabs.indexOf(state.tab);let n;if(e.key==='ArrowLeft')n=(i+1)%knownTabs.length;if(e.key==='ArrowRight')n=(i+knownTabs.length-1)%knownTabs.length;if(e.key==='Home')n=0;if(e.key==='End')n=knownTabs.length-1;if(n!==undefined){e.preventDefault();tab(knownTabs[n]);$('tab-'+knownTabs[n]).focus()}});
document.querySelectorAll('.add-device').forEach(b=>b.onclick=()=>editModal());document.querySelectorAll('.refresh').forEach(b=>b.onclick=async()=>{await refresh();notify('اطلاعات به‌روز شد.')});$('deviceSearch').oninput=renderDevices;$('historyRefresh').onclick=refresh;$('deviceFilter').onchange=$('stateFilter').onchange=refresh;
$('legacyQR').onclick=()=>linkModal(state.devices.find(d=>d.id==='legacy'));$('legacyLink').onclick=()=>linkModal(state.devices.find(d=>d.id==='legacy'));$('serverSettings').onclick=serverModal;$('restart').onclick=()=>confirmModal('راه‌اندازی مجدد هسته','همهٔ اتصال‌های جاری لحظه‌ای قطع می‌شوند؛ سهمیه و اعتبار دستگاه‌ها حفظ می‌شوند.',()=>mutate('restart',{}),false,'راه‌اندازی مجدد');$('clientSettings').onclick=clientModal;$('newTrial').onclick=trialModal;
$('purgeHistory').onclick=()=>confirmModal('پاک‌سازی تاریخچه','سوابق اتصال‌های بسته و آزمایش‌ها حذف می‌شوند. مصرف سهمیه، اعتبار، لینک و دستگاه‌ها پاک یا صفر نمی‌شوند. این حذف برگشت‌پذیر نیست.',()=>mutate('history/purge',{confirm:'DELETE_HISTORY'}),true,'پاک‌سازی سوابق');$('historyExport').onclick=()=>confirmModal('دانلود تاریخچهٔ خصوصی','این فایل شامل IP و زمان اتصال است. فقط ۲۰۰ ردیف همین فیلتر صادر می‌شود؛ آن را عمومی منتشر نکنید.',async()=>{saveFile('darvazeh-private-history.json',{warning:'Private connection metadata',connections:state.history});notify('خروجی خصوصی آماده شد.','success')},false,'دانلود خصوصی');$('report').onclick=async()=>{try{saveFile('darvazeh-report.json',await api('report'));notify('گزارش بدون کلید و IP کاربران آماده شد. دامنهٔ سرور در آن وجود دارد.','success')}catch(e){notify(e.message,'error')}};
window.addEventListener('hashchange',()=>tab(location.hash.slice(1)));tab(location.hash.slice(1));boot();setInterval(()=>{if(!state.busy){if(state.csrf)refresh();else boot()}},10000);

/* ---- امکانات پیشنهادی · فقط فهرست، هیچ‌کدام فعال نیست ---- */
const IDEAS=[
 {name:'آدرس اشتراک (Subscription URL)',state:'نیازمند تصمیم',needs:'دامنهٔ شخصی ثابت + یک مسیر عمومی مثل /sub',
  why:'کلاینت با یک بار ثبت URL، خودش لینک‌ها را به‌روز می‌کند. اگر دامنهٔ اشتراک ثابت بماند، سرویس‌دهنده می‌تواند سرور را عوض کند بدون اینکه کاربر لینک جدید بگیرد. روی دامنهٔ تصادفی فعلی بی‌فایده است.'},
 {name:'ذخیره‌ساز بیرونی برای UUID و سهمیه',state:'نیازمند تصمیم',needs:'حساب بیرونی + کلید رمزنگاری + مدیریت رمز',
  why:'اگر پروژه و Volume پاک شوند، شناسه و مصرف از جای دیگر بازگردانی می‌شوند. فقط در صورتی ارزش دارد که دامنه هم ثابت باشد؛ وگرنه لینک‌ها با تغییر دامنه باز هم باطل می‌شوند.'},
 {name:'بکاپ خودکار به فضای بیرونی',state:'نیازمند تصمیم',needs:'مقصد ذخیره‌سازی + زمان‌بندی + کلید رمزنگاری',
  why:'نسخهٔ رمزنگاری‌شدهٔ settings.json و شمارندهٔ سهمیه به‌صورت دوره‌ای بیرون نگه داشته می‌شود. برای بازگردانی سریع پس از حذف پروژه.'},
 {name:'دامنهٔ شخصی',state:'نیازمند تصمیم',needs:'دامنهٔ مالکیت شما + رکورد DNS',
  why:'تنها راهی که لینک‌ها را با ساخت مجدد پروژه زنده نگه می‌دارد. باید سهمیهٔ هفتگی گواهی Let\'s Encrypt در ساخت مکرر حساب شود.'},
 {name:'نمایش IP و کشور واقعی',state:'نیازمند تأیید میزبان',needs:'TRUSTED_PROXY_CIDRS معتبر + فایل GeoLite2-Country.mmdb',
  why:'بدون تأیید زنجیرهٔ پراکسی، IP واقعی قابل انتساب نیست و بدون بانک جغرافیایی، کشور «نامشخص» می‌ماند. تا آن زمان نمایش IP/کشور جعلی تولید نمی‌شود.'},
 {name:'کاربران آنلاین به‌صورت زنده',state:'پیاده‌سازی‌نشده',needs:'اتصال پایدار (SSE یا WebSocket) بین پنل و سرور',
  why:'در نسخهٔ فعلی اتصال‌های باز فقط در ۱۰ ثانیه یک‌بار به‌روز می‌شوند. زنده‌بودن نیاز به کانال پیوسته دارد و تک‌نمونه بودن سرور را الزامی‌تر می‌کند.'},
 {name:'ورود دومرحله‌ای (TOTP)',state:'قابل پیاده‌سازی',needs:'فقط کتابخانهٔ استاندارد پایتون + برنامهٔ Authenticator شما',
  why:'با رمز فعلی، هر کسی که رمز را ببیند وارد می‌شود. TOTP بدون وابستگی بیرونی اضافه شدنی است.'},
 {name:'محدودیت سرعت هر دستگاه',state:'نیازمند تغییر هسته',needs:'تغییر policy در کانفیگ Xray و بازآزمایی',
  why:'برای اینکه یک دستگاه سهمیهٔ کل را نخورد. روی همین معماری یک‌نمونه قابل اعمال است ولی نیاز به آزمون اتصال دارد.'},
 {name:'خروجی گرفتن از لینک‌ها',state:'قابل پیاده‌سازی سریع',needs:'حداقل کار؛ فقط یک خروجی متنی از پنل',
  why:'برای بکاپ گرفتن از نام دستگاه‌ها و لینک‌ها پیش از هر تغییر بزرگ. دقیقاً برخلاف اشتراک، به دامنهٔ ثابت نیاز ندارد.'},
 {name:'تنظیم سطح لاگ خام',state:'نیازمند تصمیم',needs:'تغییر سیاست حریم خصوصی + رمزنگاری فایل لاگ',
  why:'در نسخهٔ فعلی خروجی خام هسته عمداً دور ریخته می‌شود تا مقصد کاربران در لاگ نیفتد. فعال‌کردن آن باید آگاهانه و با رمزنگاری باشد.'},
 {name:'ربات تلگرام برای تحویل لینک',state:'نیازمند تصمیم',needs:'توکن ربات + کانال امن برای ارسال',
  why:'تحویل خودکار لینک به کاربر. اما سطح حملهٔ تازه‌ای اضافه می‌کند و لینک خصوصی از یک کانال بیرونی می‌گذرد.'},
 {name:'XHTTP به‌جای WebSocket',state:'فقط پژوهشی',needs:'تغییر کانفیگ هسته + پشتیبانی ورودی میزبان + آزمون اپراتور',
  why:'مستندات Xray مهاجرت از WS را پیشنهاد می‌کند، ولی سازگاری با لبهٔ میزبان و کلاینت شما هنوز آزموده نشده است.'}
];
function renderIdeas(){const grid=$('ideaGrid');if(!grid)return;grid.replaceChildren();for(const idea of IDEAS){const card=el('div',null,'profile idea');card.append(el('h3',idea.name));const pillRow=el('div',null,'idea-state');pillRow.append(pill(idea.state,idea.state==='قابل پیاده‌سازی'||idea.state==='قابل پیاده‌سازی سریع'?'good':'neutral'));card.append(pillRow);card.append(el('p',idea.why));card.append(el('p','پیش‌نیاز: '+idea.needs,'idea-needs'));grid.append(card)}}

/* ---- اتصال رویدادهای تب افزودن دستگاه ---- */
$('addDraftRow').onclick=()=>{if(addDraft.rows.length>=100){notify('حداکثر ۱۰۰ ردیف در جدول دستی.','error');return}addDraft.rows.push({name:'',gb:String(ADD_PRESET.gb),days:String(ADD_PRESET.days)});renderDraft()};
$('stageDraft').onclick=()=>{const ready=addDraft.rows.filter(r=>String(r.name).trim());if(!ready.length){notify('حداقل یک ردیف با نام پر کنید.','error');return}stageRows(ready,'table');addDraft.rows=[{name:'',gb:String(ADD_PRESET.gb),days:String(ADD_PRESET.days)}];renderDraft()};
$('stageCsv').onclick=()=>{try{stageRows(csvToRows($('csvText').value),'csv')}catch(e){notify('CSV خوانده نشد: '+e.message,'error')}};
$('clearCsv').onclick=()=>{$('csvText').value='';$('csvFile').value=''};
$('csvFile').onchange=async e=>{const file=e.target.files&&e.target.files[0];if(!file)return;try{$('csvText').value=await file.text();notify('فایل خوانده شد؛ حالا «تحلیل CSV» را بزنید.','success')}catch{notify('خواندن فایل ناموفق بود.','error')}};
$('stageCode').onclick=()=>{try{stageRows(rowsFromObjects(parseJsList($('codeText').value)),'code')}catch(e){notify('رشته خوانده نشد: '+e.message,'error')}};
$('clearCode').onclick=()=>{$('codeText').value=''};
$('importStaged').onclick=()=>importStaged().catch(e=>notify(e.message,'error'));
$('clearStaged').onclick=()=>{state.addRows=[];renderStaged()};
$('selectAllDevices').onchange=e=>{const rows=filteredDevices();if(e.target.checked)rows.forEach(d=>state.selected.add(d.id));else rows.forEach(d=>state.selected.delete(d.id));renderDevices()};
$('bulkDelete').onclick=()=>bulkAction('delete');
$('bulkEnable').onclick=()=>bulkAction('enable');
$('bulkDisable').onclick=()=>bulkAction('disable');
$('bulkClear').onclick=()=>{state.selected.clear();renderDevices()};
renderDraft();renderIdeas();
