const config = require('config');
const express = require('express');
const cookieSession = require('cookie-session');
const request = require('request');
const crypto = require('crypto');
const util = require('util');

const encrypt = (data, key) => {
    const cipher = crypto.createCipher('aes256', key);
    return cipher.update(JSON.stringify(data), 'utf8', 'hex') + cipher.final('hex');
};

const decrypt = (str, key) => {
    try {
        const decipher = crypto.createDecipher('aes256', key);
        return JSON.parse(decipher.update(str, 'hex', 'utf8') + decipher.final('utf8'));
    }
    catch (e) {
        return {};
    }
};

const newKey = async() => {
    const bitsPerKey = config.get('keybits');
    const data = await util.promisify(crypto.randomBytes)(bitsPerKey);
    return data.toString('hex');
};

const main = async() => {
    const app = express();

    app.use(express.urlencoded({ extended: false }));

    const cekey = await newKey();

    const keys = [];
    for (let i = 0; i < config.get('keycount'); i++) {
        const key = await newKey();
        keys.push(key);
    }
    app.use(cookieSession({
        name: 'kPlexSSOKookie',
        keys: keys,
        maxAge: config.get('sessionexpiry')
    }));

    app.get('/api/v1/background', (req, res) => {
        request(`${config.get('ombi')}/api/v1/Images/background/`, (err, _, body) => {
            if (err) {
                res.status(500).send(body);
            }
            else {
                res.json(JSON.parse(body));
            }
        });
    });

    app.all('/api/v1/sso', (req, res) => {
        const loginData = decrypt(req.session.data, cekey);
        loginData.nowInMinutes = Math.floor(Date.now() / 60e3);
        loginData.loginStatus = !!loginData.loginStatus;
        req.session.data = encrypt(loginData, cekey);
        res.status(loginData.loginStatus ? 200 : 401).json({
            success: loginData.loginStatus
        });
    });

    app.post('/api/v1/login', (req, res) => {
        console.log(req);
        const username = req.body.username || '';
        const password = req.body.password || '';
        request({
            url: 'https://plex.tv/users/sign_in.json',
            method: 'POST',
            headers: {
                'X-Plex-Client-Identifier': 'PlexSSOv1',
                'X-Plex-Product': 'PlexSSO',
                'X-Plex-Version': '3',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'application/json'
            },
            body: `user[login]=${username}&user[password]=${password}`
        }, (err, r, body) => {
            try {
                body = JSON.parse(body);
                if (err || body.error) {
                    throw new Error('Something went wrong');
                }
            }
            catch (e) {
                res.status(401).json({
                    success: false,
                    error: 'Login failed. Please check your login details.'
                });
                return;
            }

            res.status(200).json({
                success: true,
                detail: body
            });
        });
    });

    app.use(express.static(config.get('webroot')));

    app.get('*', (req, res) => {
        res.redirect('/index.html');
    });

    const port = config.get('port');
    app.listen(port, () => console.log(`Listening at http://*:${port}`));
};
main();