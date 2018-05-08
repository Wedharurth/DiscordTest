const fs = require('fs');
const forever = require('forever-monitor');
const settings = require('./settings/ayano.json');
const acsettings = require('./settings/general.json');
const Discord = require("discord.io");
const djs = require("discord.js");
const cardmanager = require('./modules/cardmanager.js');
const dbmanager = require('./modules/dbmanager.js');
const utils = require("./modules/localutils.js");
var MongoClient = require('mongodb').MongoClient;

var restarts = 0;
var mongodb, stdout, child, isrestart = false;

var bot = new Discord.Client({
    token: settings.token,
    autorun: true
});

bot.on("ready", (event) => {
    console.log('[Ayano.bot] Logged in as %s - %s\n', bot.username, bot.id);
    if(child) return;

    child = new (forever.Monitor)(settings.startpoint, {
        max: -1,
        silent: false,
        killTree: true,
        minUptime: 4000
    });

    child.on('exit', function () {
        bot.sendMessage({
            to: settings.reportchannel, 
            embed: formError("Process EXIT", "Amusement club stopped")
        });
        restarts = 0;
    });

    child.on('error', function (err) {
        bot.sendMessage({
            to: settings.reportchannel, 
            embed: formError("Process exited with code 1!", err)
        });
        console.log('[Ayano ERROR] ' + err);
    });

    child.on('stderr', function (err) {
        bot.sendMessage({
            to: settings.reportchannel, 
            embed: formError("Unhalded promise rejection", err)
        });
        console.log('[Ayano ERROR] ' + err);
    });

    child.on('stop', function (data) {
        if(isrestart) return;
        bot.sendMessage({
            to: settings.reportchannel, 
            embed: formConfirm("Process stopped", "Amusement Club was manually stopped")
        });
        console.log('[Ayano] Bot stopped');
    });

    child.on('start', function (data) {
        bot.sendMessage({
            to: settings.reportchannel, 
            embed: formWarn("Starting bot", "Starting Amusement Club...")
        });
        setTimeout(() => {
            bot.sendMessage({
                to: settings.reportchannel, 
                embed: formConfirm("Process started", "Amusement Club bot process is now running")
            });
        }, 4000);
        console.log('[Ayano] Bot started');
    });

    child.on('restart', function (data) {
        restarts++;
        bot.sendMessage({
            to: settings.reportchannel, 
            embed: formWarn("Restarting bot", "Restarting Amusement Club...")
        });
        setTimeout(() => {
            bot.sendMessage({
                to: settings.reportchannel, 
                embed: formConfirm("Restarted", "Amusement Club was restarted and now online again!")
            });
        }, 4000);
        console.log('[Ayano] Bot restarted');
        isrestart = false;
    });

    MongoClient.connect(acsettings.database, function(err, db) {
        if(err) return console.log("[Ayano ERROR] DB connect error: " + err);
        console.log('[Ayano] Connected to DB'); 
        mongodb = db;
    });

    //child.start();
    //console.log(child);

    bot.on("disconnect", (errMsg, code) => {
        if(errMsg || code) { 
            console.log("[Ayano ERROR#" + code + "] " + errMsg);
            setTimeout(() => bot.connect(), 1000);
        }
        console.log("[Ayano] Discord Bot Disconnected");
    });

    bot.on("message", (username, userID, channelID, message, event) => {
        if(!message.startsWith("ayy")) return;
        if(message.toLowerCase() === "ayy") {
            bot.sendMessage({
                to: channelID, 
                message: "lmao"
            });
            return;
        }

        if(channelID == settings.reportchannel) {
            //console.log(message.substring(4));
            switch(message.substring(4).split(' ')[0]) {
                case 'help':
                    showCommands(); break;
                case 'update': 
                    console.log('[Ayano] Trying to update cards...'); 
                    updateCards(); break;
                case 'start': 
                    console.log('[Ayano] Starting Amusement Club process...'); 
                    child.start(); break;
                case 'rename': 
                    rename(message.substring(11)); break;
                case 'stop': 
                    if(userID == settings.adminID) {
                        console.log('[Ayano] Stopping Amusement Club process...'); 
                        child.stop(); 
                    } break;
                case 'restart': 
                    console.log('[Ayano] Restarting Amusement Club process...'); 
                    restarts = 0; 
                    isrestart = true;
                    child.restart(); break;
                default:
                    if(userID == settings.adminID)
                        other(message.substring(4));
            }
        }
    });
});

function formError(title, desc) {
    let e = new djs.RichEmbed();
    e.setColor('#DB1111');
    e.setTitle(title);
    e.setDescription(desc);
    e.setFooter("Ayano: Amusement Club monitoring | Restartcount: " + restarts);
    return e;
}

function formConfirm(title, desc) {
    let e = new djs.RichEmbed();
    e.setColor('#0FBA4D');
    e.setTitle(title);
    e.setDescription(desc);
    e.setFooter("Ayano: Amusement Club monitoring");
    return e;
}

function formWarn(title, desc) {
    let e = new djs.RichEmbed();
    e.setColor('#ffc711');
    e.setTitle(title);
    e.setDescription(desc);
    e.setFooter("Ayano: Amusement Club monitoring");
    return e;
}

function showCommands(argument) {
    bot.sendMessage({
        to: settings.reportchannel, 
        embed: formConfirm("Command list", "update [cards]\nstart [bot]\nstop [bot]\nrestart [bot]")
    });
}

function rename(argument) {
    if(!mongodb){
        bot.sendMessage({
            to: settings.reportchannel, 
            embed: formError("Can't update card", "The connection to database is invalid")
        });
        return;
    } 

    argument = argument.split(',');
    if(argument.length < 2) 
        return bot.sendMessage({
            to: settings.reportchannel, 
            embed: formError("Can't update card", "Make sure you have getter and setter split by `,`")
        });

    let getstr = argument[0].toLowerCase().split(' ');
    let setstr = argument[1].toLowerCase();
    let result = "";
    let query = utils.getRequestFromFiltersNoPrefix(getstr);

    mongodb.collection('cards').findOne(query).then(card => {
        if(!card)
            return bot.sendMessage({
                to: settings.reportchannel, 
                embed: formError("Can't update card", "Card was not found")
            });

        let newname = setstr.trim().replace(/ /gi, '_');
        mongodb.collection('cards').update(query, {$set: {name: newname}}).then(res => {
            result += "Card is updated in database\n";
            mongodb.collection('users').updateMany(
                utils.getRequestFromFilters(getstr), {$set: {"cards.$.name": newname}}, false, true).then(res => {

                result += "Found **" + res.matchedCount + "** users with this card\n";
                result += "Modified **" + res.modifiedCount + "** user cards\n";

                let oldPath = dbmanager.getCardFile(card);
                if(fs.existsSync(oldPath)) {
                    card.name = newname;
                    fs.renameSync(oldPath, dbmanager.getCardFile(card));
                    result += "Card file **renamed**\n";
                } else {
                    result += "Card file **not renamed**\n";
                }

                result += "Card update finished\n";
                return bot.sendMessage({
                    to: settings.reportchannel, 
                    embed: formConfirm("Update finished", result)
                });
            });
        });
    });
}

function updateCards() {
    if(!mongodb){
        bot.sendMessage({
            to: settings.reportchannel, 
            embed: formError("Can't update cards", "The connection to database is invalid")
        });
        return;
    } 

    cardmanager.updateCards(mongodb, cards => {
        let e = new djs.RichEmbed();
        e.setColor('#0FBA4D');
        e.setTitle("Finished updating cards");
        if(cards.length == 0) e.setDescription("No cards were added");
        else {
            var emb = "";
            cards.map(c => {
                emb += "**" + c.name.replace('=', '') + "** collection got **" + c.count + "** new cards\n";
            });
            e.setDescription(emb);
        }

        bot.sendMessage({
            to: settings.reportchannel, 
            embed: e
        });
    });
}

function askDB(args) {
    var split = args.split('(');
    var col = split[0].substring(3);
    var query = split[1].substring(0, 1);
}

function other(args) {
    console.log("[Ayano] Executing: " + args);

    if(args.startsWith('db.')) {
        return askDB(args);
    }
    args = args.split(' ');

    try {
        stdout = "";
        let child = forever.start(args, {
            max : 0,
            silent : false,
        });

        child.on('stdout', function (data) {
            stdout += data + "\n";
        });

        child.on('exit', function (code) {
            bot.sendMessage({
                to: settings.reportchannel, 
                embed: formConfirm(args, stdout)
            });
        });
    } catch(e) {
        bot.sendMessage({
            to: settings.reportchannel, 
            embed: formError("Can't spawn process " + args, e)
        });
    }
}

function startChanging() {
    let images = require('./serverpics.json');

    setInterval(() => {
        console.log("set pic");
        setPic(1, (err) => {
            setTimeout(() => {
                setPic(0);
            }, 3000)
        });
    }, 100000);

    setInterval(() => {
        setPic(2, () => {
            setTimeout(() => {
                setPic(0);
            }, 3000)
        });
    }, 310000);
}

function setPic(index, callback) {
    bot.editServer( {"serverID":"351871492536926210", "icon":images[index]}, callback);
}