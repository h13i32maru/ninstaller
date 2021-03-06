(function(global){
  'use strict';

  /**
   * 関数を指定されてオブジェクトに束縛する.
   * @param {function} func 束縛する関数.
   * @param {Object} oThis 束縛するオブジェクト.
   * @param {...*} [var_args=] 束縛する引数.
   * @returns {Function} 束縛された関数.
   */
  var bind = function (func, oThis, var_args) {
    if (typeof func !== "function") {
      // closest thing possible to the ECMAScript 5 internal IsCallable function
      throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");
    }

    var aArgs = Array.prototype.slice.call(arguments, 2),
      fToBind = func,
      fNOP = function () {},
      fBound = function () {
        return fToBind.apply(this instanceof fNOP && oThis
          ? this
          : oThis,
          aArgs.concat(Array.prototype.slice.call(arguments)));
      };

    fNOP.prototype = func.prototype;
    fBound.prototype = new fNOP();

    return fBound;
  };

  /**
   * オブジェクトの配列を指定されたキーを元にマップに変換する.
   * @param {Object[]} array 変換元の配列.
   * @param {string} key マップに変換するときに使用するオブジェクト内のキー名.
   * @returns {Object} 変換されたマップ.
   * @example
   * var array = [{foo: 'aaa'}, {foo: 'bbb'}, {foo: 'ccc'}];
   * var map = arrayToMap(array, 'foo');
   * console.log(map); //{aaa: {foo: 'aaa'}, bbb: {foo: 'bbb'}, ccc: {foo: 'ccc'}}
   */
  var arrayToMap = function(array, key) {
    var result = {};
    for (var i = 0; i < array.length; i++) {
      var val = array[i];
      result[val[key]] = val;
    }
    return result;
  };

  global.nInstaller = {
    _manifestUrl: null,
    _newManifest: null,
    _currentManifest: null,

    /**
     * 指定されたmanifestを読み込んでリソースのインストールを行う.
     * @param {string} manifestUrl manifest.jsonのURL.
     * @param {function} callback リソースのインストールが終わった後に実行されるコールバック関数.
     */
    init: function(manifestUrl, callback) {
      this._manifestUrl = manifestUrl;
      var seq = new this.CallbackSeq();

      seq.addAsync(bind(this._fetchNewManifest, this));
      seq.addAsync(bind(this._loadCurrentManifest, this));
      seq.addSync(bind(this._calcNewResource, this));
      seq.addAsync(bind(this._fetchResources, this));
      seq.addAsync(bind(this._saveResources, this));
      seq.addSync(bind(this._complete, this), callback);

      seq.start();
    },

    /**
     * サーバから新しいマニフェストを取得する.
     * @param {function()} callback マニフェスト取得完了時に実行されるコールバック関数
     * @private
     */
    _fetchNewManifest: function(callback) {
      var manifestUrl = this._manifestUrl;
      var xhr = new XMLHttpRequest();

      var _this = this;
      xhr.onload = function(){
        var manifestText = xhr.responseText;
        _this._newManifest = JSON.parse(manifestText);
        callback();
      };

      xhr.open('GET', manifestUrl, true);
      xhr.send();
    },

    /**
     * 現在のマニフェストを取得する.
     * @param {function()} callback 現在のマニフェスト取得完了時に実行されるコールバック関数.
     * @private
     */
    _loadCurrentManifest: function(callback) {
      var db = openDatabase('ninstaller', "0.1", "nInstaller", 5 * 1000 * 1000);
      db.transaction(transaction, error);

      var _this = this;
      function transaction(tr) {
        tr.executeSql('CREATE TABLE IF NOT EXISTS manifest (manifest TEXT)');
        tr.executeSql('SELECT * from manifest', null, function(transaction, result){
          if (result.rows.length < 1) {
            callback();
          } else {
            var row =  result.rows.item(0);
            _this._currentManifest = JSON.parse(row.manifest);
            callback();
          }
        });
      }

      function error(e) {
        console.error(e);
      }
    },

    /**
     * 現在のマニフェストと新しいマニフェストを比較して必要なリソース情報を取得する.
     * @returns {Object[]} リソース情報の配列.
     * @private
     */
    _calcNewResource: function() {
      var newManifest = this._newManifest;
      var currentManifest = this._currentManifest;
      var resources;
      if (!currentManifest) {
        resources = [].concat(newManifest.js.resources);
      } else {
        resources = [];
        var currentResourcesMap = arrayToMap(currentManifest.js.resources, 'path');
        var newResources = newManifest.js.resouces;
        for (var i = 0; i < newResources.length; i++) {
          var newResource = newResources[i];
          var currentResource = currentResourcesMap[newResource.path];
          if (newResource.md5 !== currentResource.md5) {
            resources.push(newResource);
          }
        }
      }

      return resources;
    },

    /**
     * リソースをサーバから取得する.
     * @param {Object[]} resources リソース情報の配列.
     * @param {function(resources: Object[])} callback リソース取得完了時に実行されるコールバック関数.
     * @private
     */
    _fetchResources: function(resources, callback) {
      var index = 0;
      var xhr = new XMLHttpRequest();
      fetch();

      //TODO: 並列読み込みにする
      function fetch(){
        if (resources.length === index) {
          callback(resources);
          return;
        }

        var res = resources[index];
        xhr.onload = function(){
          var content = xhr.responseText;
          res.content = content;
          index++;
          fetch();
        };
        xhr.open('GET', res.path, true);
        xhr.send();
      }
    },

    /**
     * リソースをDBに保存する.
     * @param {Object[]} resources 保存するリソース.
     * @param {function} callback 保存完了時に実行されるコールバック関数.
     * @private
     */
    _saveResources: function(resources, callback) {
      var db = openDatabase('ninstaller', "0.1", "nInstaller", 5 * 1000 * 1000);
      db.transaction(transaction, error, success);

      function transaction(tr) {
        tr.executeSql('CREATE TABLE IF NOT EXISTS js (path TEXT PRIMARY KEY, md5 TEXT, time TEXT, content TEXT)', []);
        for (var i = 0; i < resources.length; i++) {
          var res = resources[i];
          tr.executeSql('INSERT OR REPLACE INTO js (path, md5, time, content) VALUES (?, ?, ?, ?)', [res.path, res.md5, res.time, res.content]);
        }
      }

      function error(e) {
        console.log(e);
      }

      function success() {
        callback();
      }
    },

    /**
     * nInstallerの初期化呼び出し元に初期化が完了したことを通知する.
     * @param {function} callback 初期化完了時に呼び出されるコールバック関数.
     * @private
     */
    _complete: function(callback) {
      callback();
    }
  };

})(window);
