module.exports = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ status: 'ok', message: 'Movie Recommendation API is running' });
}; 