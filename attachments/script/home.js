var app = {
	baseURL: util.getBaseURL(window.location.href),
	container: 'main_content',
	emitter: util.registerEmitter(),
	cache: {}
};

couch.dbPath = app.baseURL + "api/";
couch.rootPath = couch.dbPath + "couch/";

app.handler = function(route) {
  if (route.params && route.params.route) {
    var path = route.params.route;
    app.routes[path](route.params.id);
  } else {    
    app.routes['home']();
  }  
};

app.showDatasets = function(name) {
  var url = app.baseURL + "api/datasets/";
  if (name) {
    url += name;
  } else {
    name = "Recent Datasets";
  }
  return couch.request({url: url}).then(function(resp) {
    var datasets = _.map(resp.rows, function(row) {
      return {
        url: app.baseURL + 'edit#/' + row.id,
        user: row.doc.user,
        gravatar_url: row.doc.gravatar_url,
        size: util.formatDiskSize(row.doc.disk_size),
        name: row.value,
        date: row.doc.createdAt,
        nouns: row.doc.nouns,
        count: row.doc.doc_count - 1 // TODO calculate this programatically
      };
    })
    if (datasets.length > 0) {
      util.render('datasets', 'datasetsContainer', {name: name, datasets: datasets});      
    } else {
      couch.request({url: app.baseURL + "api/users/" + name}).then(
        function(res) { util.render('datasets', 'datasetsContainer', {name: name}) }
      , function(err) { util.render('noUser', 'datasetsContainer', {name: name}) }
      )
    }
  })
}

app.routes = {
  home: function() {
    if (window.location.pathname.indexOf('_rewrite') > -1) {
      var user = window.location.pathname.split('_rewrite')[1].replace('/', '');
    } else {
      var user = $.url(window.location.pathname).segment()[0];
    }
    if (user.length > 0) {
      app.showDatasets(user);
    } else {
      app.emitter.on('login', function(name) {
        app.showDatasets(name);
        app.emitter.clear('login');
      })
      app.emitter.on('session', function(session) {
        if(!session.userCtx.name) app.showDatasets();
      })
    }
    
    monocles.fetchSession();
  },
  new: function() {
    monocles.ensureProfile().then(function(profile) {
      util.show('dialog');
      util.render( 'newDatasetForm', 'dialog-content' );
    })
  },
  settings: function() {
    monocles.ensureProfile().then(function(profile) {
      util.show('dialog');
      util.render( 'editProfileForm', 'dialog-content', profile );
    })    
  },
  logout: function() {
    couch.logout().then(function() {
      util.render('userControls', 'userControls');
      delete app.session;
      $( '#header' ).data( 'profile', null );
      app.sammy.setLocation("#");
    })
  }
}

app.after = {
  newProfileForm: function() {
    $('.cancel').click(function(e) {
      util.hide('dialog');
      app.sammy.setLocation("#");
    })
    $(".profile_setup input[name='username']").keyup(function() {
      var input = $(this);
      input.removeClass('available').removeClass('notAvailable').addClass('loading');
      $('.username-message').text('');
      util.delay(function() {
        var username = input.val();
        couch.get( "users/search/" + username).then(function(response) {
          input.removeClass('loading');
          if ( response.rows.length > 0 ) {
            input.addClass('notAvailable');
            $('.username-message').text('username taken!')
          } else {
            input.addClass('available');
            $('.username-message').text('username available!')
          }
        })
      }, 500)();
    });
    $('.profile_setup').submit( function( e ) {
      monocles.generateProfile( $( e.target ) );
      e.preventDefault();
      util.hide('dialog');
      return false;
    });
  },
  editProfileForm: function() {
    $('.cancel').click(function(e) {
      util.hide('dialog');
      app.sammy.setLocation("#");
    })
    $( '.profile_setup' ).submit( function( e ) {
      monocles.updateProfile($( e.target ).serializeObject());
      e.preventDefault();
      util.hide('dialog');
      app.sammy.setLocation("#");
      return false;
    });
  },
  newDatasetForm: function() {
    var doc = {}, docID;
    couch.request({url: couch.rootPath + "_uuids"}).then( function( data ) { docID = data.uuids[ 0 ] });
    $('.cancel').click(function(e) {
      util.hide('dialog');
      app.sammy.setLocation("#");
    })
    var inputs = $(".dataset_setup textarea[name='description'], .dataset_setup input[name='name']");
    var renderIcons = _.throttle(function() {
        var input = $(this);
        input.addClass('loading');
        app.cache.words = {};
        var words = _.reduce(inputs, function(memo, el){ return memo + " " + $(el).val() }, "").replace(/[^\w\s]|_/g, "").replace(/\s+/g, ' ').trim().split(' ');
        var requests = _.map(words, function(word) {
          var request = util.lookupIcon(word);
          request.then(function(resp) {
            var matches = _.map(_.keys(resp.svg), function(match) {
              return {
                noun: match.toLowerCase(),
                svg: resp.svg[match]
              };
            })
            matches = _.select(matches, function(match){ return word === match.noun });
            _.each(matches, function(match) {
              app.cache.words[match.noun] = match;
            })
            doc.nouns = _.map(app.cache.words, function(word) {return word});
            util.render('nouns', 'nounContainer', {nouns: doc.nouns, nounsExist: function() {return doc.nouns.length > 0}});
          })
          return request.promise();
        })
        $.when.apply(null, requests).then(function() { inputs.removeClass('loading') })
      }, 1000);
    inputs.keyup(renderIcons);
    $( '.dataset_setup' ).submit( function( e ) {
      var form = $( e.target ).serializeObject();
      $.extend(doc, {
        _id: "dc" + docID,
        name: form.name,
        type: "database",
        user: app.profile._id,
        gravatar_url: app.profile.gravatar_url,
        createdAt: new Date()
      });
      couch.request({url: app.baseURL + "api/" + doc._id, type: "PUT", data: JSON.stringify(doc)}).then(function(resp) {
        var dbID = resp.id
          , dbName = dbID + "/_design/recline"
          ;
        function waitForDB(url) {
          couch.request({url: url, type: "HEAD"}).then(
            function(resp, status){
              app.sammy.setLocation(app.baseURL + 'edit#/' + dbID);
            },
            function(resp, status){
              console.log("not created yet...", resp, status);
              setTimeout(function() {
                waitForDB(url);
              }, 500);
            }
          )
        }
        util.render('creatingDataset', 'dialog-content');
        waitForDB(couch.rootPath + dbName);
      })
      e.preventDefault();
      return false;
    });
  },
  loginButton: function() {
    $('.login').click(function(e) {
      monocles.showLogin();
      return false;
    })
  },
  tableContainer: function() {
    recline.activateControls();
  },
  dataTable: function() {
    $('.column-header-menu').click(function(e) { 
      app.currentColumn = $(e.target).siblings().text();
      util.position('menu', e);
      util.render('columnActions', 'menu');
    });
    
    $('.row-header-menu').click(function(e) { 
      app.currentRow = $(e.target).parents('tr:first').attr('data-id');
      util.position('menu', e);
      util.render('rowActions', 'menu');
    });
    
    $('.data-table-cell-edit').click(function(e) {
      var editing = $('.data-table-cell-editor-editor');
      if (editing.length > 0) {
        editing.parents('.data-table-cell-value').html(editing.text()).siblings('.data-table-cell-edit').removeClass("hidden");
      }
      $(e.target).addClass("hidden");
      var cell = $(e.target).siblings('.data-table-cell-value');
      cell.data("previousContents", cell.text());
      util.render('cellEditor', cell, {value: cell.text()});
    })
  },
  columnActions: function() { recline.handleMenuClick() },
  rowActions: function() { recline.handleMenuClick() },
  cellEditor: function() {
    $('.data-table-cell-editor .okButton').click(function(e) {
      var cell = $(e.target);
      var rowId = cell.parents('tr').attr('data-id');
      var header = cell.parents('td').attr('data-header');
      var doc = _.find(app.cache, function(cacheDoc) {
        return cacheDoc._id === rowId;
      });
      doc[header] = cell.parents('.data-table-cell-editor').find('.data-table-cell-editor-editor').val();
      util.notify("Updating row...", {persist: true, loader: true});
      costco.updateDoc(doc).then(function(response) {
        util.notify("Row updated successfully");
        recline.initializeTable();
      })
    })
    $('.data-table-cell-editor .cancelButton').click(function(e) {
      var cell = $(e.target).parents('.data-table-cell-value');
      cell.html(cell.data('previousContents')).siblings('.data-table-cell-edit').removeClass("hidden");
    })
  },
  actions: function() {
    $('.button').click(function(e) { 
      var action = $(e.target).attr('data-action');
      util.position('menu', e, {left: -60, top: 5});
      util.render(action + 'Actions', 'menu');
      recline.handleMenuClick();
    });
  },
  controls: function() {
    $('#logged-in-status').click(function(e) { 
      if ($(e.target).text() === "Sign in") {
        recline.showDialog("signIn");
      } else if ($(e.target).text() === "Sign out") {
        util.notify("Signing you out...", {persist: true, loader: true});
        couch.logout().then(function(response) {
          util.notify("Signed out");
          util.render('controls', 'project-controls', {text: "Sign in"});
        })
      }
    });
  },
  signIn: function() {
    
    $('.dialog-content #username-input').focus();
    
    $('.dialog-content').find('#sign-in-form').submit(function(e) {
      $('.dialog-content .okButton').click();
      return false;
    })
    
    $('.dialog-content .okButton').click(function(e) {
      util.hide('dialog');
      util.notify("Signing you in...", {persist: true, loader: true});
      var form = $(e.target).parents('.dialog-content').find('#sign-in-form');
      var credentials = {
        username: form.find('#username-input').val(), 
        password: form.find('#password-input').val()
      }
      couch.login(credentials).then(function(response) {
        util.notify("Signed in");
        util.render('controls', 'project-controls', {text: "Sign out"});
      }, function(error) {
        if (error.statusText === "error") util.notify(JSON.parse(error.responseText).reason);
      })
    })
    
  },
  bulkEdit: function() {
    $('.dialog-content .okButton').click(function(e) {
      var funcText = $('.expression-preview-code').val();
      var editFunc = costco.evalFunction(funcText);
      ;
      if (editFunc.errorMessage) {
        util.notify("Error with function! " + editFunc.errorMessage);
        return;
      }
      util.hide('dialog');
      costco.updateDocs(editFunc);
    })
    
    var editor = $('.expression-preview-code');
    editor.val("function(doc) {\n  doc['"+ app.currentColumn+"'] = doc['"+ app.currentColumn+"'];\n  return doc;\n}");
    editor.focus().get(0).setSelectionRange(18, 18);
    editor.keydown(function(e) {
      // if you don't setTimeout it won't grab the latest character if you call e.target.value
      window.setTimeout( function() {
        var errors = $('.expression-preview-parsing-status');
        var editFunc = costco.evalFunction(e.target.value);
        if (!editFunc.errorMessage) {
          errors.text('No syntax error.');
          costco.previewTransform(app.cache, editFunc, app.currentColumn);
        } else {
          errors.text(editFunc.errorMessage);
        }
      }, 1, true);
    });
    editor.keydown();
  },
  transform: function() {
    $('.dialog-content .okButton').click(function(e) {
      util.notify("Not implemented yet, sorry! :D");
      util.hide('dialog');
    })
    
    var editor = $('.expression-preview-code');
    editor.val("function(val) {\n  if(_.isString(val)) this.update(\"pizza\")\n}");
    editor.focus().get(0).setSelectionRange(62,62);
    editor.keydown(function(e) {
      // if you don't setTimeout it won't grab the latest character if you call e.target.value
      window.setTimeout( function() {
        var errors = $('.expression-preview-parsing-status');
        var editFunc = costco.evalFunction(e.target.value);
        if (!editFunc.errorMessage) {
          errors.text('No syntax error.');
          var traverseFunc = function(doc) {
            util.traverse(doc).forEach(editFunc);
            return doc;
          }
          costco.previewTransform(app.cache, traverseFunc);
        } else {
          errors.text(editFunc.errorMessage);
        }
      }, 1, true);
    });
    editor.keydown();
  },
  urlImport: function() {
    $('.dialog-content .okButton').click(function(e) {
      app.apiURL = $('#url-input').val().trim();
      util.notify("Fetching data...", {persist: true, loader: true});
      $.getJSON(app.apiURL + "?callback=?").then(
        function(docs) {
          app.apiDocs = docs;
          util.notify("Data fetched successfully!");
          recline.showDialog('jsonTree');
        },
        function (err) {
          util.hide('dialog');
          util.notify("Data fetch error: " + err.responseText);
        }
      );
    })
  },
  uploadImport: function() {
    $('.dialog-content .okButton').click(function(e) {
      util.hide('dialog');
      util.notify("Saving documents...", {persist: true, loader: true});
      costco.uploadCSV();
    })
  },
  jsonTree: function() {
    util.renderTree(app.apiDocs);
    $('.dialog-content .okButton').click(function(e) {
      util.hide('dialog');
      util.notify("Saving documents...", {persist: true, loader: true});
      costco.uploadDocs(util.lookupPath(util.selectedTreePath())).then(function(msg) {
        util.notify("Docs saved successfully!");
        recline.initializeTable(app.offset);
      });
    })
  },
  pasteImport: function() {
    $('.dialog-content .okButton').click(function(e) {
      util.notify("Uploading documents...", {persist: true, loader: true});
      try {
        var docs = JSON.parse($('.data-table-cell-copypaste-editor').val());        
      } catch(e) {
        util.notify("JSON parse error: " + e);
      }
      if (docs) {
        if(_.isArray(docs)) {
          costco.uploadDocs(docs).then(
            function(docs) {
              util.notify("Data uploaded successfully!");
              recline.initializeTable(app.offset);
              util.hide('dialog');
            },
            function (err) {
              util.hide('dialog');
              util.notify("Error uploading: " + err.responseText);
            }
          );        
        } else {
          util.notify("Error: JSON must be an array of objects");
        } 
      }
    })
  },
  datasets: function() {
    $('.timeago').timeago();
    $('svg').height('15px').width('25px');
  },
  nouns: function() {
    $('svg').height('30px').width('50px');
  }
}

app.sammy = $.sammy(function () {
  this.get('', app.handler);
  this.get("#/", app.handler);
  this.get("#:route", app.handler);
  this.get("#:route/:id", app.handler);
});

$(function() {  
  app.sammy.run();  
})