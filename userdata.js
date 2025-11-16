const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userDataSchema = Schema({
    firstName: {
        type: String,
        required: true
    },
    lastName: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    testInvitation: {
        type: String,
        required: true
    },
    id: {
        type: String,
        required: true,
        unique: true
    },
    images: [{
        id: {
            type: String,
            required: true
        },
        url: {
            type: String,
            required: true
        }
    }]
});

module.exports = mongoose.model('UserData', userDataSchema);