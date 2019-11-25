const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const Blockchain = require('./blockchain');
const uuid = require('uuid/v1');
const port = process.argv[2];
const rp = require('request-promise');

const nodeAddress = uuid().split('-').join('');

const bruhCoin = new Blockchain();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

app.get('/blockchain', (req, res) => {
    res.send(bruhCoin);
});

app.post('/transaction', (req, res) => {
    const newTransaction = req.body;
    const blockIndex = bruhCoin.addTransactionsToPendingTransactions(newTransaction);
    res.json({note: `The transactions will be available in block no: ${blockIndex}`});
});

app.post('/transaction/broadcast', (req,res) => {
    const newTransaction = bruhCoin.createNewTransaction(req.body.amount, req.body.sender, req.body.reciever);
    bruhCoin.addTransactionsToPendingTransactions(newTransaction);

    const requestPromises = [];
    bruhCoin.networkNodes.forEach(networkNodeURL => {
        const requestOptions = {
            uri: networkNodeURL + '/transaction',
            method: 'POST',
            body: newTransaction,
            json: true
        }   
        requestPromises.push(rp(requestOptions));
    });
    Promise.all(requestPromises)
    .then(data => {
        res.json({note: 'Transaction create and broadcast complete'});
    })
});

app.get('/mine', (req, res) => {
    const lastBlock = bruhCoin.getLastBlock();
    const previousBlockHash = lastBlock.hash;
    const currentData = {
        transactions: bruhCoin.pendingTransactions,
        index: lastBlock.index + 1
    };
    const nonce = bruhCoin.proofOfWork(previousBlockHash, currentData);
    const blockHash = bruhCoin.hashBlock(previousBlockHash, currentData, nonce);

    const newBlock = bruhCoin.createNewBlock(nonce,previousBlockHash,blockHash);
    console.log(newBlock);
    const requestPromises = [];
    bruhCoin.networkNodes.forEach(networkNodeURL => {
        const requestOptions = {
            uri: networkNodeURL + '/recieve-new-block',
            method: 'POST',
            body: {newBlock: newBlock},
            json: true
        };
        requestPromises.push(rp(requestOptions));
    });

    Promise.all(requestPromises)
    .then(data => {
        const requestOptions = {
            uri: bruhCoin.currentNodeURL + '/transaction/broadcast',
            method: 'POST',
            body: {
                amount: 12.5,
                sender: "00",
                reciever: nodeAddress
            },
            json: true
        }
        return rp(requestOptions);
    })
    .then(data => {
        res.json({note: 'New Block Mined Successfully', newBlock: newBlock});
    });

});

app.post('/recieve-new-block', (req,res) => {
    const newBlock = req.body.newBlock;
    const lastBlock = bruhCoin.getLastBlock();
    const correctHash = (lastBlock.hash === newBlock.previousBlockHash);
    const correctIndex = (lastBlock.index + 1 === newBlock.index);

    if(correctHash && correctIndex) {
        bruhCoin.chain.push(newBlock);
        bruhCoin.pendingTransactions = [];
        res.json({note: 'New Block Recieved and accepted', newBlock: newBlock});
    } else {
        res.json({note: 'New Block Recieved and rejected', newBlock: newBlock});
    }
});

app.post('/register-and-broadcast-node', (req, res) => {
    const newNodeURL = req.body.newNodeURL;
    if(bruhCoin.networkNodes.indexOf(newNodeURL) == -1)
        bruhCoin.networkNodes.push(newNodeURL);
    console.log(newNodeURL);
    const regNodesPromise = [];
    bruhCoin.networkNodes.forEach(networkNodeURL => {
        const requestOptions = {
            uri: networkNodeURL + '/register-node',
            method: 'POST',
            body: {
                newNodeURL: newNodeURL
            },
            json: true
        }
    
        regNodesPromise.push(rp(requestOptions));
    });
    console.log(newNodeURL+'/register-nodes-bulk');
    Promise.all(regNodesPromise)
    .then(data => {
        const bulkRegistrationOptions = {
            uri: newNodeURL + '/register-nodes-bulk',
            method: 'POST',
            body: {
                allNetworkNodes: [...bruhCoin.networkNodes, bruhCoin.currentNodeURL]
            },
            json: true
        }

        return rp(bulkRegistrationOptions);
    })
    .then(data => {
        res.json({note: 'New Node Registered With the network'});
    }).catch(err => console.log('The request has timed out'));
});

app.post('/register-node', (req,res) => {
    const newNodeURL = req.body.newNodeURL;
    const urlNotPresentInNode = bruhCoin.networkNodes.indexOf(newNodeURL) == -1;
    const notCurrentNode = bruhCoin.currentNodeURL !== newNodeURL;
    if(urlNotPresentInNode && notCurrentNode)
        bruhCoin.networkNodes.push(newNodeURL);
    res.json({node: 'New Node Succesfully Registered'});
});

app.post('/register-nodes-bulk', (req,res) => {
    const allNetworkNodes = req.body.allNetworkNodes;
    allNetworkNodes.forEach(networkNodeURL => {
        const nodeNotAlreadyPresent = bruhCoin.networkNodes.indexOf(networkNodeURL) == -1;
        const notCurrentNode = bruhCoin.currentNodeURL !== networkNodeURL;
        if(nodeNotAlreadyPresent && notCurrentNode) {
            bruhCoin.networkNodes.push(networkNodeURL);
        }
    });
    res.json({note: 'Bulk Registration Successful'});
});

app.get('/consensus', (req,res) => {
    const requestPromises = [];
    bruhCoin.networkNodes.forEach(networkNodeURL=> {
        const requestOptions = {
            uri: networkNodeURL + '/blockchain',
            method: 'GET',
            json: true
        }
        requestPromises.push(rp(requestOptions));
    })

    Promise.all(requestPromises)
    .then(blockchains => {
        const currentChainLength = bruhCoin.chain.length;
        let maxChainLength = currentChainLength;
        let newLongestChain = null;
        let newPendingTransactions= null;

        blockchains.forEach(blockchain => {
            if(blockchain.chain.length > maxChainLength){
                maxChainLength = blockchain.chain.length;
                newLongestChain = blockchain.chain;
                newPendingTransactions = blockchain.pendingTransactions;
            }
        });

        if(!newLongestChain || !(newLongestChain && bruhCoin.chainIsValid(newLongestChain))){
            res.json({ note: 'Current Chain not Replaced',
            chain: bruhCoin.chain });
        } else {
            bruhCoin.chain = newLongestChain;
            bruhCoin.pendingTransactions = newPendingTransactions;
            res.json({ note: 'This chain has been replaced', chain: bruhCoin.chain});
        }
    })

});

app.get('/block/:blockHash', (req,res) => {
    const blockHash = req.params.blockHash;
    const correctBlock = bruhCoin.getBlock(blockHash);
    res.json({block: correctBlock});
});

app.get('/transaction/:transactionId', (req,res) => {
    const transactionId = req.params.transactionId;
    const transactionData = bruhCoin.getTransaction(transactionId);
    res.json({transaction: transactionData.transaction,
        block: transactionData.block});
});

app.get('/address/:address', (req, res) => {
    const address = req.params.address;
    const addressData = bruhCoin.getAddressData(address);
    res.json({
        addressData: addressData
    });
});

app.get('/block-explorer', (req,res) => {
    res.sendFile('./block-explorer/index.html', {root: __dirname});
})

app.listen(port, () => {
    console.log(`Runnning on Port ${port}`);
}); 