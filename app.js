if(process.env.NODE_ENV !== "production") {
    require('dotenv').config();
}

const express = require('express');
const path = require('path');

const ejsMate = require ('ejs-mate');
const moment = require('moment');
const $ = require('jquery');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const joi = require('joi');
const session = require('express-session')
const flash = require('connect-flash');
const mongoStore = require('connect-mongo');
const passport = require('passport');
const LocalStrategy = require('passport-local');



const multer = require('multer');
const {storage} = require('./cloudinary/index.js');
const upload = multer({ 
    storage: storage,
    limits: { 
        fileSize: 5000000,
        files: 1,
    },
    fileFilter: function (req, file, cb) {
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
            return cb(new Error('Only image files are allowed!'));
        }
        cb(null, true);
      }
     
}); 

const { cloudinary } = require('./cloudinary')


const JWT = require('jsonwebtoken');
const nodemailer = require('nodemailer');
let transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_KEY
    }
});

async function sendEmail(userEmail, subject, emailBody) {
    const info = await transporter.sendMail({
        from: `"artCollector Team" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: subject,
        text: emailBody,
    }).catch(console.error);
    return info ? info.messageID : null; 
}


const fs = require('fs');
const XLSX = require('xlsx');

const ExpressError = require('./utilities/ExpressError');
const catchAsync = require('./utilities/catchAsync');
const isLoggedIn  = require('./utilities/isLoggedIn')



const app = express();

app.set('views', path.join(__dirname, 'views'));
app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');

app.use('/public', express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride ('_method'));
app.use(
    express.static(path.join(__dirname, "node_modules/bootstrap/dist/"))
  );

app.use(function (err, req, res, next) {
    const { status = 500, message = 'Something went wrong! :('} = err; 
    res.status(status).send(message);
})

app.use(session({secret: 'adkanqiwnqiwen23131§21§'}));

app.use(flash());


const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/artCollection',
{ useNewUrlParser: true, useUnifiedTopology: true })
.then(() => {
    console.log('connection open!')
})
.catch(err => {
    console.log('oh no!')
    console.log(err)
});

const ArtPiece = require('./models/artPiece.js');
const User = require('./models/user.js');

const collection = require('./routes/collection')

app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(User.authenticate()));


app.use((req, res, next) => {

    res.locals.currentUser = req.user;

    res.locals.success = req.flash('success');
 //this middleware is here so that on every single request, we're going to take whatever is in locals under 'succes' and have access to it
 // so we don't have to pass through msg.flash("success") everytime
     res.locals.error = req.flash('error');
 //res.locals makes it so that we don't have to pass it through and it's available to every page
 next();
 })
 


passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());


app.use('/collection', collection)





app.get('/home', (req, res, next) => {
    res.render('homepage')
});

app.get('/register', (req, res, next) => {
    res.render('register')
})

app.post('/register', catchAsync(async (req, res, next) => {
    try{
        const { username, email, password } = req.body;
        const user = new User ({ email: `${email}`, username: `${username}`});
        const registeredUser = await User.register(user, password);

        sendEmail(email, 'Welcome to artCollector', 
        `Hi,
        Welcome to our site!

        Just wanted to let you know: 
        if you're having any problems or want to provide info on any bugs: use this e-mail adress.

        This should be the first and the last automatic message you'll ever get from us.

        We wish you all the best, 
        artCollector team
      `)

        req.login(registeredUser, err => {
            if (err) return next(err);
            req.flash('success', 'Welcome!');
            res.redirect('/collection');
        }
        )

    } catch(err){
        req.flash('error', err.message,'.', 'Try again, please!');
        res.redirect('/home');
    }
}))

app.post('/login', passport.authenticate('local', { failureFlash: true, failureRedirect: '/home' }), (req, res) => {
    req.flash('success', 'Welcome back!');
    res.redirect('/collection');
})

app.get('/preferences', isLoggedIn, (req, res, next) => {
    console.log(req.user);
    res.render('preferences');
})

app.put('/preferences/edit', isLoggedIn, catchAsync (async (req, res, next) => {

    console.log(req.body.custom_table)

    if (req.body.custom_table){
        await User.findOneAndUpdate(req.user._id, {
            custom_table: req.body.custom_table
        })
    } else {
        await User.findOneAndUpdate(req.user._id, { 
            username: req.body.username,
            email: req.body.email,
            show_name: req.body.show_name,
            contact_info: req.body.contact_info,
    })};
    req.flash('success', 'Your changes have been saved!');
    res.redirect('/collection')
        
}))

app.put('/preferences/change_password', isLoggedIn, catchAsync (async (req, res, next) => {
    User.findOne({ username: req.user.username })
    .then((u) => {
        (u.setPassword(req.body.new_password,(err, u) => {
            if (err) return next(err);
            u.save();
            res.status(200).json({ message: 'password change successful' });
        }));
        req.flash('success', 'Your password has been changed. Next time you log in, use your new password!');
        res.redirect('/collection')
    })
}))
    



app.get('/logout', (req, res, next) => {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        req.flash('success', 'Goodbye!');
        res.redirect('/home')
    })
})


app.post('/forgotten', catchAsync(async (req, res, next) => {
    
    const { email } = req.body;
    const origin = req.headers.origin;

    
    await User.findOne({ email: email })
    .then((u) => {
        if(u){
            const secret = process.env.JWT_SECRET + u.password
            const payload = {
                email: u.email,
                id: u._id
            }
            const token = JWT.sign(payload, secret, {expiresIn: '15m'})
            const link = `${origin}/password_reset/${u._id}/${token}`
            sendEmail(u.email, 'Password Reset', 
            `Hi,

            It seems that you have requested a password reset. 
            If you want to proceed: click the link below and follow the instructions. 
            The link will be available for 15 minutes only. 

            ${link}

            Take care, 
            artCollector team
          `)
            req.flash('success', 'An email with furhter instructions has been sent to the provided adress.')
            res.redirect('/home')
            
        } else {
            req.flash('error', 'Invalid e-mail adress. Try again!')
            res.redirect('/home')
        }

    })
}));


app.get('/password_reset/:id/:token', (req, res, next) => {

    const { id, token } = req.params

    User.findById(id)
    .then((u) => {
        if (u) {
        console.log(u)
        if (!u) {
            req.flash('Invalid id!')
            res.redirect('/home')
        } else {
            const secret = process.env.JWT_SECRET + u.password;
            try {
                const payload = JWT.verify(token, secret)
                res.render('password_reset',  { email: u.email })
            } catch(error) {
                res.send(error.message);
            }
        }
    } else {
        req.flash('error', 'We encountered a mistake: no such user id. Please, try again.')
        res.redirect('/home')
    }
})

});

app.post('/password_reset/:id/:token', (req, res, next) => {
    console.log('yes, im changing' )

    const { id, token } = req.params
    User.findById(id)
        .then((u) => {
            (u.setPassword(req.body.new_password,(err, u) => {
                if (err) return next(err);
                u.save();
                res.status(200).json({ message: 'password change successful' });
            }));
            req.flash('success', 'Your password has been changed. Next time you log in, use your new password!');
            res.redirect('/home')
        })
});

app.get('/preferences/deleteAcc', isLoggedIn, (req, res, next) => {
    res.render('preferences_deleteAcc')
});


app.delete('/preferences/deleteAcc/confirmed', passport.authenticate('local', { failureFlash: true, failureRedirect: '/preferences' }), isLoggedIn, catchAsync(async (req, res, next) => {

console.log('authentication success')


    const pieces = await ArtPiece.find({ user_id: req.user._id } );

   for (let p of pieces) {
        for (let img of p.images){
                await cloudinary.uploader.destroy(img.filename)
        }};

   await ArtPiece.deleteMany({ user_id: req.user._id });

    await User.findByIdAndDelete(req.user._id);

    req.flash('success', 'Goodbye :(');
   
    res.redirect('/home');


    }));







app.all('*', (req, res, next) => {      //*star* means 'for every path'
    next(new ExpressError('Page not found', 404))
})

//error handling middleware yasss
app.use((err, req, res, next) => {
    const { statusCode = 500 } = err;
    // in the line above we destructure any error that is passed to this function
    // and also set a default error
    if (!err.message) err.message = 'Oh no, Something went wrong!'
    res.status(statusCode).render('./error', { err });
    //here, we set a status code to appear in the console and send a message 
})

app.listen(3000, () => {
    console.log('Serving on port 3000!')
});
