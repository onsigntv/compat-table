// Copyright 2012 Dan Wolff | danwolff.se
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


require('object.assign').shim();
var pickBy = require('lodash.pickby');
var process = require('process');

var interpolateAllResults = require('./build-utils/interpolate-all-results');

var fs = require('fs');
var path = require('path');
// var os = require('os');
var cheerio = require('cheerio');
var fl = require('fast-levenshtein');
// var child_process = require('child_process');

const args = {};
const flags = {};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith("--")) {
    const argValues = arg.slice(2).split("=", 2);
    args[argValues[0]] = argValues[1];
  } else if (arg.startsWith("-")) {
    flags[arg.slice(1)] = true;
  } else {
    throw "Invalid argument" + arg;
  }
}

const scrape = flags.s || flags.scrape;
const excludeCurrentBrowser = flags.x || flags.exclude;

const environmentsPath = args.environments || './environments.json';
const customResultsPath = args.customResults;

const useCompilers = false;

const environments = JSON.parse(fs.readFileSync(__dirname + path.sep + environmentsPath, 'utf-8'));
const customResults = customResultsPath && JSON.parse(fs.readFileSync(__dirname + path.sep + customResultsPath, 'utf-8'));

var STAGE2 = 'draft (stage 2)';

var isOptional = function isOptional(category) {
  return (category || '').indexOf('annex b') > -1 || category === STAGE2;
};

var byTestSuite = function(suite) {
  return function(browser) {
    return Array.isArray(browser.test_suites) ? browser.test_suites.indexOf(suite)>-1 : true;
  };
};

function closestString(possibilities, input) {
  var closest;
  for (var i = possibilities.length - 1, distance_min = Infinity; i >= 0; i--) {
    var next_dist = fl.get(possibilities[i], input);
    if (next_dist < distance_min) {
      closest = possibilities[i];
      distance_min = next_dist;
    }
  }
  return closest;
}

// let prototypes declared below in this file be initialized
process.nextTick(function () {
  var es5 = require('./data-es5');
  es5.browsers = pickBy(environments, byTestSuite('es5'));
  es5.customResults = customResults?.es5;
  handle(es5);
  var es6 = require('./data-es6');
  es6.browsers = pickBy(environments, byTestSuite('es6'));
  es6.customResults = customResults?.es6;
  handle(es6);
  var es2016plus = require('./data-es2016plus');
  es2016plus.browsers = pickBy(environments, byTestSuite('es2016plus'));
  es2016plus.customResults = customResults?.es2016plus;
  handle(es2016plus);
  var esnext = require('./data-esnext');
  esnext.browsers = pickBy(environments, byTestSuite('esnext'));
  esnext.customResults = customResults?.esnext;
  handle(esnext);
  var esintl = require('./data-esintl');
  esintl.browsers = pickBy(environments, byTestSuite('esintl'));
  esintl.customResults = customResults?.esintl;
  handle(esintl);
  var nonStandard = require('./data-non-standard');
  nonStandard.browsers = pickBy(environments, byTestSuite('non-standard'));
  nonStandard.customResults = customResults?.nonStandard;
  handle(nonStandard);

  // ES6 compilers
  if (!useCompilers) {
    return;
  }
  if (!fs.existsSync('es5/compilers')) {
    fs.mkdirSync('es5/compilers');
  }
  if (!fs.existsSync('es6/compilers')) {
    fs.mkdirSync('es6/compilers');
  }
  if (!fs.existsSync('es2016plus/compilers')) {
    fs.mkdirSync('es2016plus/compilers');
  }
  if (!fs.existsSync('esnext/compilers')) {
    fs.mkdirSync('esnext/compilers');
  }
  var babel = require('@babel/standalone');
  var traceur = require('traceur');
  var esdown = require('esdown');
  var jstransform = require('jstransform/simple');
  var ts = require('typescript');
  var esprima = require('esprima');
  var espree = require('espree');
  var jshint = require('jshint');
  [
    {
      name: 'es5-shim',
      url: 'https://github.com/es-shims/es5-shim',
      target_file: 'es5/compilers/es5-shim.html',
      polyfills: ['node_modules/es5-shim/es5-shim.js'],
      compiler: String,
    },
  ].forEach(function(e){
    Object.assign(es5, e);
    es5.browsers = {};
    es5.skeleton_file = 'es5/compiler-skeleton.html';
    handle(es5);
  });
  [
    {
      name: 'es6-shim',
      url: 'https://github.com/paulmillr/es6-shim/',
      target_file: 'es6/compilers/es6-shim.html',
      polyfills: ['node_modules/es6-shim/es6-shim.js'],
      compiler: String,
    },
    {
      name: 'Traceur',
      url: 'https://github.com/google/traceur-compiler/',
      target_file: 'es6/compilers/traceur.html',
      polyfills: ['node_modules/traceur/bin/traceur-runtime.js'],
      compiler: function(code) {
        return traceur.compile(code);
      },
    },
    {
      name: 'babel',
      url: 'https://babeljs.io/',
      target_file: 'es6/compilers/babel.html',
      polyfills: [],
      compiler: function(code) {
        return babel.transform(code, {presets: ['es2015'], sourceType: "script"}).code;
      },
    },
    {
      name: 'babel + core-js',
      url: 'https://babeljs.io/',
      target_file: 'es6/compilers/babel-core-js.html',
      polyfills: ['node_modules/core-js-bundle/index.js', 'node_modules/regenerator-runtime/runtime.js'],
      compiler: function(code) {
        return babel.transform(code, {presets: ['es2015'], sourceType: "script"}).code;
      },
    },
    {
      name: 'ES6 Transpiler',
      url: 'https://github.com/termi/es6-transpiler',
      target_file: 'es6/compilers/es6-transpiler.html',
      polyfills: [],
      compiler: (function() {
        var es6tr;
        return function(code) {
          // Known bug: running require('es6-transpiler') causes babel to break.
          // So, it's run here, as late as possible.
          es6tr = es6tr || require('es6-transpiler');
          var result = es6tr.run({src:code});
          if (result.src) {
            return result.src;
          }
          throw new Error('\n' + result.errors.join('\n'));
        };
      }()),
    },
    {
      name: 'esdown',
      url: 'https://github.com/zenparsing/esdown',
      target_file: 'es6/compilers/esdown.html',
      polyfills: [],
      compiler: function(code) {
        return esdown.transform(code, { runtime: true, polyfill: true });
      },
    },
    {
      name: 'esprima',
      url: 'http://esprima.org/',
      target_file: 'es6/compilers/esprima.html',
      compiler: function(code) {
        try {
          esprima.parse(code);
          return "(function(){return true;})";
        } catch(e) {
          return "/*\n" + e.message + "\n*/\n(function(){return false;})";
        }
      },
    },
    {
      name: 'espree',
      url: 'http://espree.org/',
      target_file: 'es6/compilers/espree.html',
      compiler: function(code) {
        try {
          espree.parse(code,{
            ecmaFeatures: {
            arrowFunctions: true,
            blockBindings: true,
            destructuring: true,
            regexYFlag: true,
            regexUFlag: true,
            templateStrings: true,
            binaryLiterals: true,
            octalLiterals: true,
            unicodeCodePointEscapes: true,
            defaultParams: true,
            restParams: true,
            forOf: true,
            objectLiteralComputedProperties: true,
            objectLiteralShorthandMethods: true,
            objectLiteralShorthandProperties: true,
            objectLiteralDuplicateProperties: true,
            generators: true,
            spread: true,
            classes: true,
            modules: true,
            globalReturn: true
          }});
          return "(function(){return true;})";
        } catch(e) {
          return "/*\n" + e.message + "\n*/\n(function(){return false;})";
        }
      },
    },
    {
      name: 'jshint',
      url: 'http://jshint.com/',
      target_file: 'es6/compilers/jshint.html',
      compiler: function(code) {
        var result = jshint.JSHINT(code,{
          asi:true, boss:true, elision:true, eqnull:true, esnext:true,
          evil:true, expr:true, laxbreak:true, laxcomma:true, loopfunc:true,
          multistr: true, noyield:true, plusplus:true, proto:true, sub:true,
          supernew: true, validthis:true, withstmt:true, nonstandard:true, typed:true,
          "-W032":true,
        });
        if (result) {
          return "(function(){return true;})";
        } else {
          return "/*\n" + jshint.JSHINT.errors.map(function(e){ return (e && e.reason) || ""; }).join('\n')
            + "\n*/\n(function(){return false;})";
        }
      },
    },
    {
      name: 'JSX',
      url: 'https://github.com/facebook/react',
      target_file: 'es6/compilers/jsx.html',
      polyfills: [],
      compiler: function(code) {
        var ret = jstransform.transform(code, { harmony:true });
        return ret.code || ret;
      },
    },
    {
      name: 'TypeScript',
      url: 'https://www.typescriptlang.org/',
      target_file: 'es6/compilers/typescript.html',
      polyfills: [],
      compiler: function (code) {
        return ts.transpile(code, { downlevelIteration: true });
      }
    },
    {
      name: 'TypeScript + core-js',
      url: 'https://www.typescriptlang.org/',
      target_file: 'es6/compilers/typescript-core-js.html',
      polyfills: ["node_modules/core-js-bundle/index.js"],
      compiler: function (code) {
        return ts.transpile(code, { downlevelIteration: true });
      }
    },
    /*
    {
      name: 'Closure Compiler',
      url: 'https://developers.google.com/closure/compiler/',
      target_file: 'es6/compilers/closure.html',
      polyfills: [],
      compiler: function(code) {
        var fpath = os.tmpDir() + path.sep + 'temp.js';
        fs.writeFileSync(fpath, code);
        var output;
        try {
          output = "" + child_process.execSync('./node_modules/.bin/google-closure-compiler-js ' +
            fpath +
            ' --languageIn=ECMASCRIPT6 --languageOut=ECMASCRIPT5 --rewritePolyfills --warningLevel=QUIET'
          );
        } catch(e) {
          throw new Error('\n' + e.stdout.toString().split(fpath).join(''));
        }
        return output;
      },
    },
    */
  ].forEach(function(e){
    Object.assign(es6, e);
    es6.browsers = {};
    es6.skeleton_file = 'es6/compiler-skeleton.html';
    handle(es6);
  });
  [
    {
      name: 'babel + core-js',
      url: 'https://babeljs.io/',
      target_file: 'esnext/compilers/babel-core-js.html',
      polyfills: ['node_modules/core-js-bundle/index.js', 'node_modules/regenerator-runtime/runtime.js'],
      compiler: function(code) {
        return babel.transform(code, {presets: [['env', { forceAllTransforms: true }], ['stage-0', { decoratorsBeforeExport: true }]], sourceType: "script"}).code;
      },
    },
    {
      name: 'es7-shim',
      url: 'https://github.com/es-shims/es7-shim/',
      target_file: 'esnext/compilers/es7-shim.html',
      polyfills: ['node_modules/es7-shim/dist/es7-shim.js'],
      compiler: String,
    },
    {
      name: 'JSX',
      url: 'https://github.com/facebook/react',
      target_file: 'esnext/compilers/jsx.html',
      polyfills: [],
      compiler: function(code) {
        var ret = jstransform.transform(code, { harmony:true });
        return ret.code || ret;
      },
    },
    {
      name: 'TypeScript + core-js',
      url: 'https://www.typescriptlang.org/',
      target_file: 'esnext/compilers/typescript-core-js.html',
      polyfills: ["node_modules/core-js-bundle/index.js"],
      compiler: ts.transpile
    },
  ].forEach(function(e){
    Object.assign(esnext, e);
    esnext.browsers = {};
    esnext.skeleton_file = 'esnext/compiler-skeleton.html';
    handle(esnext);
  });
  [
    {
      name: 'babel + core-js',
      url: 'https://babeljs.io/',
      target_file: 'es2016plus/compilers/babel-core-js.html',
      polyfills: ['node_modules/core-js-bundle/index.js', 'node_modules/regenerator-runtime/runtime.js'],
      compiler: function(code) {
        return babel.transform(code, {presets: ['es2015', 'es2016', 'es2017']}).code;
      },
    },
    {
      name: 'es7-shim',
      url: 'https://github.com/es-shims/es7-shim/',
      target_file: 'es2016plus/compilers/es7-shim.html',
      polyfills: ['node_modules/es7-shim/dist/es7-shim.js'],
      compiler: String,
    },
    {
      name: 'JSX',
      url: 'https://github.com/facebook/react',
      target_file: 'es2016plus/compilers/jsx.html',
      polyfills: [],
      compiler: function(code) {
        var ret = jstransform.transform(code, { harmony:true });
        return ret.code || ret;
      },
    },
    {
      name: 'TypeScript + core-js',
      url: 'https://www.typescriptlang.org/',
      target_file: 'es2016plus/compilers/typescript-core-js.html',
      polyfills: ["node_modules/core-js-bundle/index.js"],
      compiler: ts.transpile
    },
  ].forEach(function(e){
    Object.assign(es2016plus, e);
    es2016plus.browsers = {};
    es2016plus.skeleton_file = 'es2016plus/compiler-skeleton.html';
    handle(es2016plus);
  });
});

function handle(options) {
  var skeleton = fs.readFileSync(__dirname + path.sep + options.skeleton_file, 'utf-8');
  var html = dataToHtml(skeleton, options.browsers, options.tests, options.compiler, options.customResults);

  var replacements = [
    ["<!-- NAME -->", [options.name]],
    ["<!-- URL -->", [options.name.link(options.url)]],
    ["<!-- POLYFILLS -->", !options.polyfills ? [] : options.polyfills.map(function(e) {
      return '<script>' + fs.readFileSync(__dirname + path.sep + e, 'utf-8').replace(/<(?=\/script>)/g,'\\u003c') + '</script>\n';
    })],
  ];
  var filename = options.target_file;
  if (scrape) {
    replacements.push(["<!-- SCRAPE_SCRIPT -->", ['<script src="../scraper.js"></script>']]);
    filename = filename.replace(".html", "_scraper.html");
  }
  var result = replaceAndIndent(html, replacements).replace(/\t/g, '  ');

  var target_file = __dirname + path.sep + filename;
  var old_result;
  try {
    old_result = fs.readFileSync(target_file, 'utf-8');
  } catch (e) {}
  if (old_result === result) {
    console.log('[' + options.name + '] ' + options.target_file + ' not changed');
  } else {
    fs.writeFileSync(target_file, result, 'utf-8');
    console.log('[' + options.name + '] Write to file ' + options.target_file);
  }
}

function dataToHtml(skeleton, rawBrowsers, tests, compiler, customResults) {
  var $ = cheerio.load(skeleton);
  var head = $('table thead tr:last-child');
  var body = $('table tbody');
  var isNonStandardTable = $('.non-standard table').length > 0;
  var footnoteIndex = {};
  var rowNum = 0;
  var noOfBrowserPerPlatformType = {
    desktop: 0,
    compiler: 0,
    engine: 0,
    mobile: 0
  };

  if (excludeCurrentBrowser) {
    $('table').addClass('no-current');
    $('table thead tr:first-child th:first-child').attr('colspan', 1);
  }

  // rawBrowsers includes very obsolete browsers which mustn't be printed, but should
  // be used by interpolateResults(). All other uses should use this, which filters
  // the very obsolete ones out.
  var browsers = Object.keys(rawBrowsers).reduce(function(obj,e) {
    var browser = rawBrowsers[e];
    if (browser.obsolete !== "very") {
      obj[e] = browser;

      if (!browser.obsolete && !browser.unstable) {
           noOfBrowserPerPlatformType[browser.platformtype || 'desktop']++;
      }
    }
    // Even if it's very obsolete, include its footnote if it has one
    else if (browser.note_html && browser.note_id) {
      footnoteIndex[browser.note_id] = browser.note_html;
    }
    return obj;
  },{});

  // Adjust platformType header colspans to match # of browsers displayed by default
  Object.keys(noOfBrowserPerPlatformType).forEach(platformType => {
    const count = noOfBrowserPerPlatformType[platformType];
    $(`table thead tr:first-child th#${platformType}-header`).attr('colspan', count);
  });

  function getHtmlId(id) {
    return 'test-' + id;
  }

  function footnoteHTML(obj) {
    if (obj && obj.note_id) {
      if (!footnoteIndex[obj.note_id]) {
        if (obj.note_html) {
          footnoteIndex[obj.note_id] = obj.note_html;
        }
      }
      var num = Object.keys(footnoteIndex).indexOf(obj.note_id) + 1;
      return '<a href="#' + obj.note_id + '-note"><sup>[' + num + ']</sup></a>';
    }
    return '';
  }

  function allFootnotes() {
    var ret = $('<div>');
    Object.keys(footnoteIndex).forEach(function(e,id) {
      if (!(e in footnoteIndex)) {
        console.error("There's no footnote with id '" + e + "'");
      }
      ret.append('<p id="' + e + '-note">' +
      '\t<sup>[' + (id + 1) + ']</sup> ' + footnoteIndex[e] +
      '</p>');
    });
    return ret;
  }

  function testValue(result) {
    if (result && typeof result === "object" && "val" in result) {
      return result.val;
    }
    return result;
  }

  function escapeTestName(name) {
    return name.replace(/^[\s<>&"',]+|[\s<>&"',]+$/g, '').replace(/[\s<>&"]+/g, '_');
  }

  function generateMdnLink(url) {
      return ' <a href="' + url + '" title="MDN documentation"><img src="../mdn.png" alt="MDN (Mozilla Development Network) logo" width="15" height="13" /></a>&nbsp;';
  }

  // Write the browser headers
  Object.keys(browsers).forEach(function(browserId) {
    var b = browsers[browserId];
    if (!b) {
      throw new Error('No browser with ID ' + browserId);
    }
    head.append($('<th></th>')
      .addClass("platform " + browserId + ' ' + (b.platformtype || 'desktop'))
      .addClass(b.obsolete ? "obsolete" : b.unstable ? "unstable" : "")
      .attr("data-browser", browserId)
      .append(
        $('<a href="#' + browserId + '" class="browser-name"></a>')
          .append('<abbr title="' + b.full + '">' + b.short + '</abbr>'))
      .append(footnoteHTML(b)
      )
    );
  });

  interpolateAllResults(tests, environments, customResults);

  // Now print the results.
  tests.forEach(function(t, testNum) {
    var id = escapeTestName(t.name);
    var name = t.name;
    if (t.spec) {
        name = '<a href="' + t.spec + '">' + t.name + '</a>';
    }

    if (t.mdn) {
        name += generateMdnLink(t.mdn);
    }

    if (t.links) {
      t.links.forEach(function(link) {
        name += footnoteHTML(link);
        footnoteIndex[link.note_id] = link.note_html;
      });
    }

    var testRow = $('<tr></tr>')
      .addClass("subtests" in t ? 'supertest' : '')
      .attr("significance",
        t.significance === "tiny" ? 0.125 :
        t.significance === "small" ? 0.25 :
        t.significance === "medium" ? 0.5 : 1)
      .addClass(isOptional(t.category) ? 'optional-feature' : '')
      .append($('<td></td>')
        .attr('id', getHtmlId(id))
        .append('<span><a class="anchor" href="#' + getHtmlId(id) + '">&sect;</a>' + name + footnoteHTML(t) + '</span></td>')
        .append(testScript(t.exec, compiler, rowNum++))
      );
    body.append(testRow);
    // If this row has a different category to the last, add a title <tr> before it.
    if (t.category && (!testNum || t.category !== tests[testNum-1].category)) {
      testRow.before('<tr class="category"><td colspan="' + (Object.keys(browsers).length+3) + '"><span>' + capitalise(t.category) + '</span></td></tr>');
    }

    // Function to print out a single <td> result cell.
    function resultCell(browserId, result, footnote) {
      if (!browsers[browserId]) {
        throw new Error(browserId + " is not found\n- Did you mean \"" + closestString(Object.keys(browsers), browserId) + "\"?");
      }
      result = testValue(result);

      // Create the cell, and add classes and attributes
      var cell = $('<td></td>');
      cell.addClass({
        'true': "yes",
        'false': "no",
        'undefined': 'unknown',
        'tally': 'tally',
        'flagged': 'no flagged',
        'needs-polyfill-or-native': 'no needs-polyfill-or-native',
        'strict': 'no strict',
        'null': 'unknown',
      }[result] || '');
      if (result === "needs-polyfill-or-native") {
        cell.attr('title', "Requires native support or a polyfill.");
      } else if (result === "strict") {
        cell.attr('title', "Support for this feature incorrectly requires strict mode.");
      }

      cell.attr('data-browser', browserId).addClass(
        browsers[browserId].obsolete ? "obsolete" :
        browsers[browserId].unstable ? "unstable" :
        "");

      // Add extra signifiers if the result is not applicable.
      if (isOptional(t.category) &&
        // Annex B is only optional for non-browsers.
        (t.category.indexOf("annex b")===-1 || (browsers[browserId].platformtype &&
          "desktop|mobile".indexOf(browsers[browserId].platformtype) === -1 &&
          !browsers[browserId].needs_annex_b))) {
        var msg = (
          t.category === STAGE2
            ? "This proposal has not yet reached stage 2"
            : "This feature is optional on non-browser platforms"
        ) + ", and doesn't contribute to the platform's support percentage.";
        cell.attr('title', msg);
        cell.addClass("not-applicable");
      }

      if (result !== 'tally') {
        cell.text({
          strict: 'Strict',
          flagged: 'Flag',
          'true': 'Yes',
          'false': 'No',
        }[result] || '?');
      }

      if (footnote) {
        cell.append(footnote);
      }
      return cell;
    }

    // Print all the results for the subtests
    if ("subtests" in t) {
      t.subtests.forEach(function(subtest) {
        var subtestName = subtest.name;

        if (subtest.spec) {
            subtestName = '<a href="' + subtest.spec + '">' + subtest.name + '</a>';
        }

        if (subtest.mdn) {
          subtestName += generateMdnLink(subtest.mdn);
        }

        var subtestId = id + '_' + escapeTestName(subtestName);

        var subtestRow = $('<tr class="subtest"></tr>')
          .attr('data-parent', id)
          .attr('id', getHtmlId(subtestId))

          .append(
            $('<td></td>')
              .append('<span><a class="anchor" href="#' + getHtmlId(subtestId) + '">&sect;</a>' + subtestName + '</span>')
              .append(testScript(subtest.exec, compiler, rowNum++))
          );
        body.append(subtestRow);

        Object.keys(browsers).forEach(function(browserId) {
          var result = subtest.res[browserId];

          subtestRow.append(resultCell(
            browserId,
            result,
            footnoteHTML(result)
          ));
        });
      });
    }

    // Print all the results for the main test
    Object.keys(browsers).forEach(function(browserId) {
      // For supertests, calculate the tally and total
      if ("subtests" in t) {

          var tally = 0, outOf = 0, flaggedTally = 0;

          t.subtests.forEach(function(e) {
            var result = e.res[browserId];

            tally += testValue(result) === true;
            flaggedTally += ['flagged','strict'].indexOf(testValue(result)) > -1;
            outOf += 1;
          });
          var grade = (tally / outOf);
          var cell = resultCell(browserId, 'tally')
            .text((tally|0) + "/" + outOf)
            .attr('data-tally', grade);
          if (grade > 0 && grade < 1 && !cell.hasClass('not-applicable') && !isNonStandardTable) {
            cell.attr('style','background-color:hsl(' + (120*grade|0) + ','
              +((86 - (grade*44))|0)  +'%,50%)');
          }

          if (flaggedTally) {
            cell.attr('data-flagged-tally',  (tally + flaggedTally) / outOf);
          }
          testRow.append(cell);
      }
      // For single tests:
      else {
        var result = t.res[browserId];

        testRow.append(resultCell(
          browserId,
          result,
          footnoteHTML(result)
        ));
      }
    });

    // Finish the <tr>
    if (t.separator === 'after') {
      body.append(
        '<tr><th colspan="' + (Object.keys(browsers).length + 3) + '" class="separator"></th></tr>'
      );
    }
  });

  $('#footnotes').append(allFootnotes().html());

  return $.root().html().replace(/(<\/t\w>)/g, "$1\n");
}

function capitalise(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function replaceAndIndent(str, replacements) {
  var i, replacement, indent;
  for (i = 0; i < replacements.length; i++) {
    replacement = replacements[i];
    indent = new RegExp('(\n[ \t]*)' + replacement[0]).exec(str);
    if (!indent) {
      indent = [null, ''];
    }
    str = str
      .split(replacement[0])
      .join(replacement[1].join(indent[1]));
  }
  return str;
}

function testScript(fn, transformFn, rowNum) {

  function deindentFunc(fn) {
    fn = (fn+'');
    var indent = /(?:^|\n)([\t ]+)[^\n]+/.exec(fn);
    if (indent) {
      fn = fn.replace(new RegExp('\n' + indent[1], 'g'), '\n');
    }
    return fn;
  }

  if (!fn) {
    return '';
  }
  if (typeof fn === 'function') {
    // see if the code is encoded in a comment
    var expr = (fn+"").match(/[^]*\/\*([^]*)\*\/\}$/);
    // if there wasn't an expression, make the function statement into one
    if (!expr) {
      if (transformFn) {
        try {
          expr = transformFn("("+fn+")");
        } catch(e) {
          expr = "false";
        }
      } else {
        expr = deindentFunc(fn);
      }
      return cheerio.load('')(excludeCurrentBrowser ? '<script></script>' : '<script>test(\n' + expr + '())</script>').attr('data-source', expr);
    } else {
      expr = deindentFunc(expr[1]);
      var transformed = false;
      if (transformFn) {
        try {
          if (expr.search(/Function\s*\(|eval\s*\(/) > -1) {
            throw new Error("This test's code invokes eval() and cannot be compiled.");
          }
          expr = transformFn("(function(){" + expr + "})");
          transformed = true;
        } catch(e) {
          expr = "/* Error during compilation: " + e.message + "*/";
        }
      }
      /* jshint unused: true */ // this appears unused, but removing it might break things.
      var async = !!/asyncTestPassed/.exec(fn);
      /* jshint unused: false */
      var codeString = JSON.stringify(expr).replace(/\\r/g,'');
      var asyncFn = 'global.__asyncPassedFn && __asyncPassedFn("' + rowNum + '")';
      var strictAsyncFn = 'global.__strictAsyncPassedFn && __strictAsyncPassedFn("' + rowNum + '")';
      var funcString =
        transformed ? '' + asyncFn + ' && eval(' + codeString + ')()'
        : 'Function("asyncTestPassed",' + codeString + ')(asyncTestPassed)';
      var strictFuncString =
        transformed ? '' + strictAsyncFn + ' && function(){"use strict";' + codeString + '}() && "Strict"'
        : 'Function("asyncTestPassed","\'use strict\';"+' + codeString + ')(asyncTestPassed)';

      return cheerio.load('')(excludeCurrentBrowser ? '<script></script>' : '<script>' +
         'test(function(){'
        +  'try{'
        +    'var asyncTestPassed=' + asyncFn + ';'
        +    'try{'
        +      'return ' + funcString
        +    '}'
        +    'catch(e){'
        +      'asyncTestPassed=' + strictAsyncFn + ';'
        +      'return ' + strictFuncString + '&&"Strict"'
        +    '}'
        +  '}'
        +  'catch(e){'
        +    'return false;'
        +  '}'
        +'}());'
        +'\n</script>').attr('data-source', expr);
    }
  } else {
    // it's an array of objects like the following:
    // { type: 'application/javascript;version=1.8', script: function () { ... } }
    return fn.reduce(function(text, script) {
      var expr = deindentFunc(
          (script.script+'').replace(/^function \(\) \{\s*|\s*\}$/g, '')
        );
      var $ = cheerio.load
        ('<script' + (script.type ? ' type="' + script.type + '"' : '') + '>' +
          expr +
          '</script>'
        );
      $('script').attr('data-source', expr);
      return text + $.html();
    },'');
  }
}
