// *********************************************************
// BsTokens APP - Banco de Sabadell
// *********************************************************

// Blockchain modules.
if (typeof process.argv[2] == 'undefined' || !["bitcoin", "ethereum", "multichain"].includes(process.argv[2])) {
  console.log("Possible parameters : bitcoin, ethereum, multichain");
  process.exit();
} else {
  var blockchain = process.argv[2];
}

// Generic libraries.
var express         = require('express');
var bodyParser      = require('body-parser');
var multer          = require('multer');
var morgan          = require('morgan');
var mongoose        = require('mongoose');
var passport        = require('passport');
var fs              = require('fs');
var cron            =  require('cron');
var cors            = require('cors');
var async           = require('async');
var jwt             = require('jwt-simple');

// App variables.
var app             = express();
var port            = process.env.PORT || 8080;

// App modules.
var User            = require('./app/models/user');
var Invitation      = require('./app/models/invitation');
var Operation       = require('./app/models/operation');

// App modules.
var userLib         = require('./app/blockchain/'+blockchain+'/user');
var contactsLib     = require("./app/contacts");
var operationsLib   = require("./app/operations");
var bsabadellLib    = require("./app/bsabadell");

// config.
var config            = require('./app/blockchain/'+blockchain+'/config'); // get db config file
var blockchainLib     = require('./app/blockchain/'+blockchain+'/lib');
// var blockchainConfig  = config.blockchain;
var blockchainInst    = false;

// Init Blockchain.
blockchainLib.init().then( function(instance) {
  blockchainInst = instance;
  if ( blockchain == "ethereum") {
    console.log("* ETHEREUM : initizalized ");
    blockchainLib.unlock(config.blockchain.addr, config.blockchain.password, blockchainInst);
    blockchainLib.startMining(config.blockchain.addr, blockchainInst);
  }
})

// Module to send emails.
var sendgrid = require('./app/sendgrid');

//use cors as we are working on a different port.
// app.use(cors({origin: 'http://localhost:8100'}));
app.use(cors({origin: 'http://bstokens.com:8100'}));

// get our request parameters
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// log to console
app.use(morgan('dev'));

// Use the passport package in our application
app.use(passport.initialize());

// connect to database
mongoose.connect(config.database.database);

// pass passport for configuration
require('./config/passport')(passport);

// bundle our routes (application)
var apiRoutes = express.Router();
var oauthRoutes = express.Router();

apiRoutes.use(function(req, res, next) {
    // Allow CORS from localhost and consentio.co
    var whitelist = ['localhost:8100', 'bstokens.com:8100'];
    var host = req.get('host');

    whitelist.forEach(function(val, key){
        if (host.indexOf(val) > -1){
            console.log("accepting "+host);
            res.setHeader('Access-Control-Allow-Origin', host);
        }
    });
    next();
});

// create a new user account
apiRoutes.post('/signup', function(req, res) {
  console.log("Signup");
  userLib.signup(req, res, blockchainInst);
});

// Authenticate a user
apiRoutes.post('/authenticate', function(req, res) {
  userLib.authenticate(req,res, blockchainInst);
});

oauthRoutes.get('/auth/bs/callback/', function(req, res) {
    bsabadellLib.authBsCallback(req,res);
});

oauthRoutes.get('/auth/bs/callback/:id', function(req, res) {
    bsabadellLib.authBsCallback(req,res);
});

// route middleware to verify a token
apiRoutes.use(function(req, res, next) {
  userLib.privateZone(req,res, next);
});

oauthRoutes.use(function(req, res, next) {
    userLib.privateZone(req,res, next);
});

/* **********************************************
  ALL API CALLS BELOW NEED A USER TO BE LOGGED IN
  ***********************************************/

// get User Information.
apiRoutes.get('/memberinfo', function(req, res) {
  // res.json({success: true, user: req.user});
  userLib.info(req,res, blockchainInst);
});

// Update user information.
apiRoutes.post('/update', function(req, res) {
  userLib.update(req,res);
});

// Issues new tokens.
apiRoutes.post('/transfer', function(req, res) {
  blockchainLib.transfer(req,res, blockchainInst);
});

// Adds money to the wallet.
apiRoutes.get('/wallet', function(req, res) {
  userLib.funds(req,res);
});

// Adds money to the wallet.
apiRoutes.put('/wallet', function(req, res) {
  userLib.wallet(req,res);
});

// route to a restricted info (GET http://localhost:8080/api/memberinfo)
apiRoutes.post('/invite', function(req, res) {
  contactsLib.invite(req,res);
});

// Change status in one invitation to connect.
apiRoutes.put('/update-status', function(req, res) {
  contactsLib.updateStatus(req,res);
});

// get User Information.
//apiRoutes.get('/contacts', passport.authenticate('jwt', { session: false}), function(req, res) {
apiRoutes.get('/contacts', function(req, res) {
  contactsLib.listContacts(req,res);
});

// get List of transactions.
apiRoutes.get('/operations', function(req, res) {
  operationsLib.listOperations(req,res);
});

// Add new transaction.
apiRoutes.post('/operation', function(req, res) {
  var usrFrom = req.user, usrTo  = null;

  userLib.getUser(req.body.operation.id)
  .then( function(res) {
    usrTo = res;
    // return blockchainLib.transfer(usrFrom.ethaddr, usrTo.ethaddr, req.body.operation.value);
    blockchainLib.transfer(usrFrom, usrTo, req.body.operation.value, blockchainInst);
  })
  .then(function() {
    return operationsLib.newOperation(usrFrom, usrTo, req.body.operation.value)
  }, function() {
    res.send({success: false, msg: 'Transfer failed'})
  })
  .then(function() {
    res.send({success: true, msg: 'Transfer Ok'})
  });

});

//oauth login
oauthRoutes.get('/auth/bs/:id', function (req, res) {
    bsabadellLib.authBsRedirect(req,res);
});

// get Token.
getToken = function (headers) {
  if (headers && headers.authorization) {
    var parted = headers.authorization.split(' ');
    if (parted.length === 2) {
      return parted[1];
    } else {
      return null;
    }
  } else {
    return null;
  }
};

// connect the api routes under /api/*
app.use('/api', apiRoutes);
app.use('/', oauthRoutes);

// Start the server
app.listen(port);
console.log("= Bstokens App with "+blockchain+ " : http://localhost:" + port);

// STart cronjob to test new input txes to Admin
var CronJob = require('cron').CronJob;
new CronJob('00 * * * * *', function() {
  blockchainLib.cashout();
}, null, true, '');
